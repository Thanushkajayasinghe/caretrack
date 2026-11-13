#!/usr/bin/env node
/**
 * =============================================================================
 * CARETRACK REAL PHONE ROAD SIMULATION SERVICE (MODE 1 - ADB INJECTION)
 * =============================================================================
 * 
 * Fetches real road networks (OSRM) starting from your PHYSICAL PHONE's current
 * GPS location, and injects realistic coordinates, speeds, and cadence into the
 * Child App over ADB.
 * 
 * Data Pipeline:
 * [OSRM Real Road Network] -> [ADB Broadcast with --ed (Double)] ->
 * [Child App Kotlin Native Service] -> [Backend HTTP API] -> [Socket.io] ->
 * [Parent App Map & Child Status Card]
 * 
 * Usage:
 *   node simulate_child_phone.cjs                  # Interactive menu
 *   node simulate_child_phone.cjs --scenario car   # Drive on real roads from home
 *   node simulate_child_phone.cjs --scenario walk  # Walk on real roads from home
 *   node simulate_child_phone.cjs --scenario run   # Jog on real roads from home
 *   node simulate_child_phone.cjs --scenario jitter# Test desk stillness & jitter filter
 *   node simulate_child_phone.cjs --scenario wakeup# Test 45s GPS sleep & sudden takeoff
 *   node simulate_child_phone.cjs --stop           # Stop any active simulation
 * =============================================================================
 */

const { execSync } = require('child_process');
const readline = require('readline');
const https = require('https');

// Fallback anchor if phone GPS is unavailable
const DEFAULT_LAT = 6.9271;
const DEFAULT_LNG = 79.8612;

function getAdbDevice() {
  try {
    const out = execSync('adb devices').toString();
    const lines = out.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('*') && !l.startsWith('List'));
    if (lines.length === 0) {
      console.error('\n❌ No ADB devices connected. Please connect your phone via USB or Wi-Fi adb.');
      process.exit(1);
    }
    return lines[0].split(/\s+/)[0];
  } catch (err) {
    console.error('❌ Failed to run adb command. Is Android SDK / adb in your PATH?', err.message);
    process.exit(1);
  }
}

/**
 * Automatically fetch the phone's live GPS/Fused location from ADB
 */
function getDeviceLocation(deviceId) {
  try {
    const out = execSync(`adb -s ${deviceId} shell dumpsys location`, { maxBuffer: 10 * 1024 * 1024 }).toString();
    const match = out.match(/last location=Location\[(?:fused|gps)\s+([-\d\.]+),([-\d\.]+)/);
    if (match) {
      return {
        lat: parseFloat(match[1]),
        lng: parseFloat(match[2]),
        source: 'phone GPS'
      };
    }
  } catch (_e) {}
  return { lat: DEFAULT_LAT, lng: DEFAULT_LNG, source: 'Colombo default' };
}

/**
 * Send simulated point over ADB.
 * NOTE: Uses --ed (Double) for lat, lng, and speed_kmh to match Kotlin getDoubleExtra()!
 */
function sendSimulatedPoint(deviceId, { lat, lng, speedKmh = 0, accuracy = 5.0, cadence = 0, activity = 'still', time = Date.now() }) {
  const cmd = `adb -s ${deviceId} shell am broadcast -a com.caretrack.child.SIMULATE_LOCATION ` +
    `--ed lat ${lat.toFixed(6)} ` +
    `--ed lng ${lng.toFixed(6)} ` +
    `--ed speed_kmh ${speedKmh.toFixed(1)} ` +
    `--ef accuracy ${accuracy.toFixed(1)} ` +
    `--ei cadence ${cadence} ` +
    `--es activity "${activity}" ` +
    `--el time ${time}`;
  try {
    execSync(cmd, { stdio: 'pipe' });
    return true;
  } catch (e) {
    return false;
  }
}

function stopSimulation(deviceId) {
  try {
    execSync(`adb -s ${deviceId} shell am broadcast -a com.caretrack.child.STOP_SIMULATION`, { stdio: 'pipe' });
    console.log(`\n🛑 Sent STOP_SIMULATION to device ${deviceId}`);
  } catch (_e) {}
}

// Great circle distance in meters
function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6378137;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Bearing between two points in degrees
function calculateBearing(lat1, lon1, lat2, lon2) {
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const y = Math.sin(dLon) * Math.cos(lat2 * Math.PI / 180);
  const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
            Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLon);
  const brng = Math.atan2(y, x) * 180 / Math.PI;
  return (brng + 360) % 360;
}

function movePoint(lat, lng, distanceMeters, bearingDeg) {
  const R = 6378137;
  const dByR = distanceMeters / R;
  const radBearing = (bearingDeg * Math.PI) / 180;
  const radLat = (lat * Math.PI) / 180;
  const radLon = (lng * Math.PI) / 180;

  const newLat = Math.asin(
    Math.sin(radLat) * Math.cos(dByR) +
    Math.cos(radLat) * Math.sin(dByR) * Math.cos(radBearing)
  );
  const newLon = radLon + Math.atan2(
    Math.sin(radBearing) * Math.sin(dByR) * Math.cos(radLat),
    Math.cos(dByR) - Math.sin(radLat) * Math.sin(newLat)
  );

  return {
    lat: (newLat * 180) / Math.PI,
    lng: (newLon * 180) / Math.PI
  };
}

/**
 * Fetch real street route coordinates from OpenStreetMap OSRM routing engine
 */
function fetchOsrmRoadRoute(waypoints, profile = 'driving') {
  return new Promise((resolve, reject) => {
    const coordStr = waypoints.map(w => `${w.lng.toFixed(6)},${w.lat.toFixed(6)}`).join(';');
    const url = `https://router.project-osrm.org/route/v1/${profile}/${coordStr}?overview=full&geometries=geojson&steps=true`;
    https.get(url, { headers: { 'User-Agent': 'CareTrackSimulator/2.0' } }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.code === 'Ok' && json.routes && json.routes[0]) {
            const rawCoords = json.routes[0].geometry.coordinates.map(c => ({ lat: c[1], lng: c[0] }));
            resolve({
              coords: rawCoords,
              distanceM: json.routes[0].distance,
              durationS: json.routes[0].duration
            });
          } else {
            reject(new Error(json.message || 'No route found by OSRM'));
          }
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

/**
 * Traverses real road polyline coordinates second-by-second at a realistic speed profile
 */
function buildRoadScenarioPoints({ coords, mode = 'car', maxSeconds = 75 }) {
  if (!coords || coords.length < 2) return [];

  // 1. Calculate segment lengths and cumulative distances
  const cumDists = [0];
  for (let i = 0; i < coords.length - 1; i++) {
    const d = distanceMeters(coords[i].lat, coords[i].lng, coords[i+1].lat, coords[i+1].lng);
    cumDists.push(cumDists[i] + d);
  }
  const totalRoadDistance = cumDists[cumDists.length - 1];

  // Helper: locate lat/lng at distance `distM` along the polyline
  function getPointAtDistance(distM) {
    if (distM <= 0) return { ...coords[0], bearing: 0, turnSharpness: 0 };
    if (distM >= totalRoadDistance) return { ...coords[coords.length - 1], bearing: 0, turnSharpness: 0 };

    for (let i = 0; i < cumDists.length - 1; i++) {
      if (distM >= cumDists[i] && distM <= cumDists[i + 1]) {
        const segLen = cumDists[i + 1] - cumDists[i];
        const ratio = segLen > 0 ? (distM - cumDists[i]) / segLen : 0;
        const lat = coords[i].lat + ratio * (coords[i + 1].lat - coords[i].lat);
        const lng = coords[i].lng + ratio * (coords[i + 1].lng - coords[i].lng);
        const brng = calculateBearing(coords[i].lat, coords[i].lng, coords[i + 1].lat, coords[i + 1].lng);

        let turnSharpness = 0;
        if (i < cumDists.length - 2) {
          const nextBrng = calculateBearing(coords[i + 1].lat, coords[i + 1].lng, coords[i + 2].lat, coords[i + 2].lng);
          let diff = Math.abs(nextBrng - brng);
          if (diff > 180) diff = 360 - diff;
          turnSharpness = diff;
        }

        return { lat, lng, bearing: brng, turnSharpness };
      }
    }
    return { ...coords[coords.length - 1], bearing: 0, turnSharpness: 0 };
  }

  const points = [];
  let traveledM = 0;
  let currentSpeedKmh = 0;

  if (mode === 'car') {
    // Car scenario: Accelerate from home -> Cruise on road (35-50 km/h) -> Red light stop (15s) -> Accelerate -> Park
    for (let s = 1; s <= maxSeconds; s++) {
      let phase = '';
      let targetSpeed = 45;

      if (s <= 8) {
        // Accelerating out of home driveway / street
        targetSpeed = s * 4.5;
        phase = `Accelerating on Neighborhood Road (${currentSpeedKmh.toFixed(0)} km/h)`;
      } else if (s >= 25 && s <= 38) {
        // Red light / traffic stop
        targetSpeed = 0;
        phase = `🛑 Stopped at Traffic Light (${38 - s}s remaining, debounce test)`;
      } else if (s > 38 && s <= 44) {
        // Green light acceleration
        targetSpeed = (s - 38) * 7.5;
        phase = `Accelerating from Green Light (${currentSpeedKmh.toFixed(0)} km/h)`;
      } else if (s >= maxSeconds - 6) {
        // Decelerating and parking
        targetSpeed = Math.max(0, (maxSeconds - s) * 5);
        phase = `Decelerating & Parking (${currentSpeedKmh.toFixed(0)} km/h)`;
      } else {
        targetSpeed = 42 + Math.sin(s * 0.4) * 6;
        phase = `Cruising along Real Road (${currentSpeedKmh.toFixed(0)} km/h)`;
      }

      // Smooth acceleration / braking (max 8 km/h per second change)
      if (currentSpeedKmh < targetSpeed) {
        currentSpeedKmh = Math.min(targetSpeed, currentSpeedKmh + 6.0);
      } else if (currentSpeedKmh > targetSpeed) {
        currentSpeedKmh = Math.max(targetSpeed, currentSpeedKmh - 10.0);
      }

      // Check upcoming turn sharpness: slow down if a sharp turn is ahead
      const probe = getPointAtDistance(traveledM + 20);
      if (probe.turnSharpness > 45 && currentSpeedKmh > 22 && s > 8 && (s < 25 || s > 44)) {
        currentSpeedKmh = Math.max(20, currentSpeedKmh - 5.0);
        phase = `Slowing for Road Turn (${currentSpeedKmh.toFixed(0)} km/h)`;
      }

      const stepM = (currentSpeedKmh / 3.6) * 1.0;
      traveledM += stepM;
      const pt = getPointAtDistance(traveledM);

      // Activity hysteresis: stays in_vehicle during traffic stops
      const activity = (s >= maxSeconds - 2 && currentSpeedKmh === 0) ? 'still' : 'in_vehicle';

      points.push({
        lat: pt.lat,
        lng: pt.lng,
        speedKmh: currentSpeedKmh,
        activity,
        cadence: 0,
        accuracy: 4.5 + Math.random() * 2.0,
        phase
      });
    }
  } else if (mode === 'walk') {
    // Walking scenario: 4.2 - 4.8 km/h along footpath/street with ~110 SPM cadence
    for (let s = 1; s <= maxSeconds; s++) {
      const spd = 4.2 + Math.sin(s * 0.25) * 0.5; // ~4.2 - 4.7 km/h
      const stepM = (spd / 3.6) * 1.0;
      traveledM += stepM;
      const pt = getPointAtDistance(traveledM);
      const cadence = 108 + Math.floor(Math.random() * 7);

      points.push({
        lat: pt.lat,
        lng: pt.lng,
        speedKmh: spd,
        activity: 'walking',
        cadence,
        accuracy: 3.5 + Math.random() * 2.0,
        phase: `Walking along Real Street (${spd.toFixed(1)} km/h, ~${cadence} SPM)`
      });
    }
  } else if (mode === 'run') {
    // Running scenario: 9.0 - 11.0 km/h along road with ~160 SPM cadence
    for (let s = 1; s <= maxSeconds; s++) {
      const spd = 9.5 + Math.sin(s * 0.3) * 1.0; // ~8.5 - 10.5 km/h
      const stepM = (spd / 3.6) * 1.0;
      traveledM += stepM;
      const pt = getPointAtDistance(traveledM);
      const cadence = 158 + Math.floor(Math.random() * 8);

      points.push({
        lat: pt.lat,
        lng: pt.lng,
        speedKmh: spd,
        activity: 'running',
        cadence,
        accuracy: 4.0 + Math.random() * 2.0,
        phase: `Jogging / Running on Real Road (${spd.toFixed(1)} km/h, ~${cadence} SPM)`
      });
    }
  }

  return points;
}

/**
 * Stationary Desk Stillness with Indoor GPS Multipath Jitter (60s)
 */
function buildJitterScenario(startLat, startLng, seconds = 60) {
  const points = [];
  for (let s = 1; s <= seconds; s++) {
    const jitterM = 3.0 + Math.random() * 6.0;
    const jitterAngle = Math.random() * 360;
    const jPoint = movePoint(startLat, startLng, jitterM, jitterAngle);
    points.push({
      lat: jPoint.lat,
      lng: jPoint.lng,
      speedKmh: 0.0,
      accuracy: 10.0 + Math.random() * 6.0,
      activity: 'still',
      cadence: 0,
      phase: s < 45 ? `Desk Stillness (Jitter ±${jitterM.toFixed(1)}m, Grace Period ${s}/45s)` : `Desk Stillness (GPS Radio SLEEP Mode, ${s}s)`
    });
  }
  return points;
}

/**
 * GPS Sleep Mode followed by Instant Sudden Motion Wakeup
 */
function buildWakeupScenario(startLat, startLng) {
  const points = [];
  for (let s = 1; s <= 48; s++) {
    points.push({
      lat: startLat,
      lng: startLng,
      speedKmh: 0.0,
      activity: 'still',
      cadence: 0,
      phase: s < 45 ? `Arming Sleep: Stillness (${s}/45s)` : `⚡ GPS Radio in SLEEP Mode (${s}s)`
    });
  }

  let curLat = startLat;
  let curLng = startLng;
  const speeds = [0, 25, 45, 55, 60, 58, 50, 35, 10, 0];
  for (const spd of speeds) {
    const distM = (spd / 3.6) * 1.0;
    const next = movePoint(curLat, curLng, distM, 60);
    curLat = next.lat;
    curLng = next.lng;
    points.push({
      lat: curLat,
      lng: curLng,
      speedKmh: spd,
      activity: spd > 10 ? 'in_vehicle' : 'still',
      cadence: 0,
      phase: `🚀 Sudden Motion Wakeup! (${spd} km/h)`
    });
  }
  return points;
}

// --- RUNNER ---
async function runScenario(deviceId, scenarioName, points) {
  console.log(`\n================================================================================`);
  console.log(`🚀 STARTING SIMULATION: [${scenarioName}]`);
  console.log(`📱 Target Device: ${deviceId}`);
  console.log(`📍 Total Steps: ${points.length} seconds (1 broadcast / second)`);
  console.log(`👀 Watch the Parent App Map and Status Card update in real time!`);
  console.log(`================================================================================\n`);

  let aborted = false;
  const onSigInt = () => {
    aborted = true;
    stopSimulation(deviceId);
    console.log('\nSimulation aborted by user.');
    process.exit(0);
  };
  process.on('SIGINT', onSigInt);

  for (let i = 0; i < points.length; i++) {
    if (aborted) break;
    const pt = points[i];
    sendSimulatedPoint(deviceId, pt);

    const progressPct = Math.round(((i + 1) / points.length) * 100);
    const speedIcon = pt.speedKmh > 20 ? '🚗' : pt.speedKmh > 7 ? '🏃' : pt.speedKmh > 0 ? '🚶' : '🛑';

    process.stdout.write(
      `\r[${String(i + 1).padStart(3, ' ')}/${points.length}] (${String(progressPct).padStart(3, ' ')}%) ` +
      `${speedIcon} ${pt.speedKmh.toFixed(1).padStart(4, ' ')} km/h | ` +
      `Act: ${pt.activity.padEnd(10, ' ')} | ` +
      `Lat: ${pt.lat.toFixed(5)}, Lng: ${pt.lng.toFixed(5)} | ` +
      `${pt.phase.padEnd(50, ' ')}`
    );

    await new Promise(r => setTimeout(r, 1000));
  }

  process.removeListener('SIGINT', onSigInt);
  stopSimulation(deviceId);
  console.log(`\n\n✅ Scenario [${scenarioName}] completed successfully!`);
}

// --- CLI INTERACTION ---
async function main() {
  const args = process.argv.slice(2);
  const deviceId = getAdbDevice();

  if (args.includes('--stop')) {
    stopSimulation(deviceId);
    process.exit(0);
  }

  // Detect physical phone location
  const homeLoc = getDeviceLocation(deviceId);

  let scenarioArg = null;
  const idx = args.indexOf('--scenario');
  if (idx !== -1 && args[idx + 1]) {
    scenarioArg = args[idx + 1].toLowerCase();
  }

  if (scenarioArg) {
    if (scenarioArg.startsWith('car')) {
      console.log(`\nFetching real road driving route from ${homeLoc.source} (${homeLoc.lat.toFixed(5)}, ${homeLoc.lng.toFixed(5)})...`);
      const dest = movePoint(homeLoc.lat, homeLoc.lng, 1200, 45);
      const res = await fetchOsrmRoadRoute([homeLoc, dest, homeLoc], 'driving');
      const pts = buildRoadScenarioPoints({ coords: res.coords, mode: 'car', maxSeconds: 75 });
      await runScenario(deviceId, 'Real Road Car Drive (from Home)', pts);
    } else if (scenarioArg.startsWith('walk')) {
      console.log(`\nFetching real footpath walking route from ${homeLoc.source} (${homeLoc.lat.toFixed(5)}, ${homeLoc.lng.toFixed(5)})...`);
      const dest = movePoint(homeLoc.lat, homeLoc.lng, 350, 90);
      const res = await fetchOsrmRoadRoute([homeLoc, dest, homeLoc], 'walking');
      const pts = buildRoadScenarioPoints({ coords: res.coords, mode: 'walk', maxSeconds: 60 });
      await runScenario(deviceId, 'Real Road Neighborhood Walk (from Home)', pts);
    } else if (scenarioArg.startsWith('run')) {
      console.log(`\nFetching real jogging route from ${homeLoc.source} (${homeLoc.lat.toFixed(5)}, ${homeLoc.lng.toFixed(5)})...`);
      const dest = movePoint(homeLoc.lat, homeLoc.lng, 600, 60);
      const res = await fetchOsrmRoadRoute([homeLoc, dest, homeLoc], 'walking');
      const pts = buildRoadScenarioPoints({ coords: res.coords, mode: 'run', maxSeconds: 60 });
      await runScenario(deviceId, 'Real Road Jogging Run (from Home)', pts);
    } else if (scenarioArg.startsWith('jitter')) {
      await runScenario(deviceId, 'Stationary Desk Stillness with Jitter', buildJitterScenario(homeLoc.lat, homeLoc.lng, 60));
    } else if (scenarioArg.startsWith('wakeup')) {
      await runScenario(deviceId, 'GPS Sleep & Sudden Wakeup', buildWakeupScenario(homeLoc.lat, homeLoc.lng));
    } else {
      console.log(`Unknown scenario: ${scenarioArg}`);
    }
    process.exit(0);
  }

  // Interactive menu
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  console.log(`\n================================================================`);
  console.log(`   CARETRACK REAL ROAD SIMULATION (FROM YOUR HOME LOCATION)     `);
  console.log(`================================================================`);
  console.log(`📱 Device Connected: ${deviceId}`);
  console.log(`📍 Origin Location:  ${homeLoc.lat.toFixed(6)}, ${homeLoc.lng.toFixed(6)} (${homeLoc.source})`);
  console.log(`🛣️  Roads Engine:    OpenStreetMap (OSRM) Real Street Network`);
  console.log(`\nSelect a scenario to simulate on actual roads outside your home:`);
  console.log(`  1. 🚗 Real Car Commute (Drive on actual streets, 0-55 km/h, traffic stop, turns)`);
  console.log(`  2. 🚶 Real Neighborhood Walk (Walk on actual roads/paths, 4.5 km/h, 110 SPM)`);
  console.log(`  3. 🏃 Real Jog / Run (Run on actual roads, 9.5 km/h, 160 SPM cadence)`);
  console.log(`  4. 🛑 Desk Stillness with GPS Jitter (±8m filter test at your desk)`);
  console.log(`  5. ⚡ GPS Sleep & Sudden Motion Wakeup (45s sleep -> 55 km/h takeoff)`);
  console.log(`  6. 🛑 Stop Current Simulation`);
  console.log(`  0. Exit\n`);

  rl.question('Enter choice [1-6]: ', async (ans) => {
    rl.close();
    try {
      switch (ans.trim()) {
        case '1': {
          console.log(`\n🌐 Querying OSRM for real street driving route around your home...`);
          const dest = movePoint(homeLoc.lat, homeLoc.lng, 1200, 45);
          const res = await fetchOsrmRoadRoute([homeLoc, dest, homeLoc], 'driving');
          console.log(`🗺️  Route found: ${(res.distanceM / 1000).toFixed(2)} km along real streets (${res.coords.length} road vertices)`);
          const pts = buildRoadScenarioPoints({ coords: res.coords, mode: 'car', maxSeconds: 75 });
          await runScenario(deviceId, 'Real Road Car Drive (from Home)', pts);
          break;
        }
        case '2': {
          console.log(`\n🌐 Querying OSRM for neighborhood footpath/street route...`);
          const dest = movePoint(homeLoc.lat, homeLoc.lng, 350, 90);
          const res = await fetchOsrmRoadRoute([homeLoc, dest, homeLoc], 'walking');
          console.log(`🗺️  Route found: ${(res.distanceM).toFixed(0)} meters along real paths (${res.coords.length} road vertices)`);
          const pts = buildRoadScenarioPoints({ coords: res.coords, mode: 'walk', maxSeconds: 60 });
          await runScenario(deviceId, 'Real Neighborhood Walk (from Home)', pts);
          break;
        }
        case '3': {
          console.log(`\n🌐 Querying OSRM for outdoor running route...`);
          const dest = movePoint(homeLoc.lat, homeLoc.lng, 600, 60);
          const res = await fetchOsrmRoadRoute([homeLoc, dest, homeLoc], 'walking');
          console.log(`🗺️  Route found: ${(res.distanceM).toFixed(0)} meters along real roads (${res.coords.length} road vertices)`);
          const pts = buildRoadScenarioPoints({ coords: res.coords, mode: 'run', maxSeconds: 60 });
          await runScenario(deviceId, 'Real Road Jogging Run (from Home)', pts);
          break;
        }
        case '4':
          await runScenario(deviceId, 'Stationary Desk Stillness with Jitter', buildJitterScenario(homeLoc.lat, homeLoc.lng, 60));
          break;
        case '5':
          await runScenario(deviceId, 'GPS Sleep & Sudden Wakeup', buildWakeupScenario(homeLoc.lat, homeLoc.lng));
          break;
        case '6':
          stopSimulation(deviceId);
          break;
        default:
          console.log('Exiting.');
      }
    } catch (e) {
      console.error('\n❌ Simulation error:', e.message);
    }
    process.exit(0);
  });
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
