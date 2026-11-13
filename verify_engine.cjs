/**
 * Simulation Test Suite for CareTrack Location & Activity Engine
 * 
 * Verifies:
 * 1. Highway speed tracking (35-60 km/h)
 * 2. Traffic crawling (3-15 km/h) -> Preserves IN_VEHICLE, never walks/runs/cycles
 * 3. Red light stop -> 5-second stillness debounce, confirms red light stop reliably
 * 4. Green light acceleration -> No 6.5 km/h speed cap when cadence = 0
 * 5. Walking departure -> Rejects 25.3 km/h GPS Doppler spike when cadence = 80 SPM
 * 6. Momentary 1-second GPS blip on highway -> Ignored, does not trigger false stop
 */

class LocationEngineSimulation {
  constructor() {
    this.isCurrentlyMoving = false;
    this.currentEstimatedSpeed = 0.0;
    this.currentActivityType = "still";
    this.stationaryAnchor = null;
    this.dwellAnchor = null;
    this.stillStartTime = 0;
    this.lastSentLocation = null;
    this.lastSentTime = 0;
    this.maxAccelerationMps2 = 4.0;
    this.maxDecelerationMps2 = 6.0;
  }

  processFix({ timeSec, lat, lng, rawGpsSpeedMps, accuracy = 5.0, cadenceSpm = 0 }) {
    const nowMs = timeSec * 1000;
    const loc = { lat, lng, speed: rawGpsSpeedMps, accuracy, time: nowMs };

    if (!this.lastSentLocation) {
      this.lastSentLocation = loc;
      this.stationaryAnchor = loc;
      this.lastSentTime = nowMs;
      this.isCurrentlyMoving = false;
      this.currentEstimatedSpeed = 0.0;
      this.currentActivityType = "still";
      return { event: "INIT", speedKmh: 0, activity: "still" };
    }

    const distFromAnchor = this.haversine(this.stationaryAnchor.lat, this.stationaryAnchor.lng, loc.lat, loc.lng);
    const distFromLast = this.haversine(this.lastSentLocation.lat, this.lastSentLocation.lng, loc.lat, loc.lng);
    const dtSec = Math.max(0.2, (nowMs - this.lastSentTime) / 1000.0);
    const spatialSpeedMps = distFromLast >= 1.0 ? distFromLast / dtSec : 0.0;

    // 1. Doppler Glitch Filter
    const hasDoppler = rawGpsSpeedMps >= 0.5 && accuracy <= 30.0;
    const isDopplerGlitch = hasDoppler && (
      (rawGpsSpeedMps >= 2.5 && distFromAnchor < 25.0 && cadenceSpm >= 15) ||
      (rawGpsSpeedMps >= 3.0 && distFromLast < 15.0 && spatialSpeedMps < 2.0) ||
      (rawGpsSpeedMps > 5.5 && cadenceSpm >= 15 && cadenceSpm <= 120)
    );

    // 2. Local Dwell & GPS Jitter Rejection:
    if (this.dwellAnchor == null) {
      if (rawGpsSpeedMps < 0.8 && cadenceSpm < 20) {
        this.dwellAnchor = loc;
      }
    } else {
      const distFromDwell = this.haversine(this.dwellAnchor.lat, this.dwellAnchor.lng, loc.lat, loc.lng);
      // Cleared as soon as vehicle moves > 20m (real-world GPS scatter is typically 15-20m) or speed exceeds 3.0 m/s (10.8 km/h)
      if (distFromDwell > 20.0 || rawGpsSpeedMps > 3.0) {
        this.dwellAnchor = null; // Departed the red light / stop cluster
      }
    }

    const isInsideDwellCluster = this.dwellAnchor != null;
    const isJitterJump = isInsideDwellCluster && (!hasDoppler || rawGpsSpeedMps < 1.2);

    const verifiedSpeedMps = isJitterJump
      ? 0.0 // Suppress jitter speed to 0 while clustered inside red light cluster
      : ((hasDoppler && !isDopplerGlitch) ? rawGpsSpeedMps : (spatialSpeedMps > 0.3 ? spatialSpeedMps : 0.0));

    const speedKmh = verifiedSpeedMps * 3.6;

    // 3. Motion & Still Evaluation
    // In vehicle context, GPS Doppler jitter under trees/bridges can report up to 2.5 km/h (0.7 m/s)
    // while completely stopped. Within the 15m dwell cluster, anything < 2.5 km/h is stillness.
    const stillThresholdKmh = isInsideDwellCluster ? 2.5 : 1.5;
    const isStationaryInput = speedKmh < stillThresholdKmh && cadenceSpm < 20;

    let emittedEvent = "STREAM";

    if (isStationaryInput) {
      if (this.isCurrentlyMoving) {
        // Stillness debouncing (5-second window)
        if (this.stillStartTime === 0) {
          this.stillStartTime = nowMs;
        }
        const stillDurationMs = nowMs - this.stillStartTime;

        if (stillDurationMs < 5000) {
          // In 5s grace period: smoothly decelerate, DO NOT lock anchor or trigger STOP yet
          this.currentEstimatedSpeed = Math.max(0.0, this.currentEstimatedSpeed - this.maxDecelerationMps2 * dtSec);
          emittedEvent = `DECELERATING (${(stillDurationMs / 1000).toFixed(1)}s still)`;
        } else {
          // 5 seconds threshold reached: genuine STOP confirmed (e.g. red light or parked)
          this.isCurrentlyMoving = false;
          this.currentEstimatedSpeed = 0.0;
          this.currentActivityType = "still";
          this.stationaryAnchor = loc;
          this.stillStartTime = 0;
          emittedEvent = "STOP_CONFIRMED";
        }
      } else {
        this.currentEstimatedSpeed = 0.0;
        this.currentActivityType = "still";
        emittedEvent = "STILL_RESTING";
      }
    } else {
      // Physically moving
      this.stillStartTime = 0; // Reset still timer
      const wasStationary = !this.isCurrentlyMoving;
      this.isCurrentlyMoving = true;

      // Activity Classification with Traffic Hysteresis
      if (this.currentActivityType === "in_vehicle") {
        // In vehicle: traffic crawling preserves IN_VEHICLE unless user starts physically walking/running
        if (cadenceSpm >= 20 && cadenceSpm <= 120) {
          this.currentActivityType = "walking";
        } else if (cadenceSpm > 120) {
          this.currentActivityType = "running";
        } else {
          // Cadence is 0 (sitting in car): stays in vehicle even at 5 km/h in traffic
          this.currentActivityType = "in_vehicle";
        }
      } else {
        // Not yet in vehicle
        if (speedKmh > 22.0 && cadenceSpm < 30) {
          this.currentActivityType = "in_vehicle";
        } else if (cadenceSpm > 120 || (speedKmh >= 9.0 && speedKmh <= 22.0 && cadenceSpm >= 50)) {
          this.currentActivityType = "running";
        } else if (speedKmh >= 9.0 && speedKmh <= 22.0 && cadenceSpm < 30) {
          this.currentActivityType = "on_bicycle";
        } else if (cadenceSpm >= 20 || speedKmh >= 1.5) {
          this.currentActivityType = "walking";
        } else {
          this.currentActivityType = "still";
        }
      }

      // Speed Estimation with Contextual Departure Cap
      let targetSpeed = verifiedSpeedMps;

      // If walking on foot, cap Doppler spike
      if (cadenceSpm >= 15 && cadenceSpm <= 120 && targetSpeed > 2.2) {
        targetSpeed = 1.8;
      }

      const maxDeltaUp = (wasStationary ? 2.5 : this.maxAccelerationMps2) * Math.min(dtSec, 3.0);
      const maxDeltaDown = this.maxDecelerationMps2 * Math.min(dtSec, 3.0);

      const maxAllowed = wasStationary
        ? (cadenceSpm >= 15 ? 1.8 : Math.max(12.0, targetSpeed)) // Car can accelerate immediately; walking capped
        : this.currentEstimatedSpeed + maxDeltaUp;

      const minAllowed = Math.max(0.0, this.currentEstimatedSpeed - maxDeltaDown);
      const clamped = Math.max(minAllowed, Math.min(maxAllowed, targetSpeed));

      this.currentEstimatedSpeed = wasStationary
        ? (cadenceSpm >= 15 ? Math.min(clamped, 1.8) : clamped)
        : this.currentEstimatedSpeed * 0.35 + clamped * 0.65;
    }

    this.lastSentLocation = loc;
    this.lastSentTime = nowMs;

    return {
      event: emittedEvent,
      speedKmh: +(this.currentEstimatedSpeed * 3.6).toFixed(1),
      activity: this.currentActivityType
    };
  }

  haversine(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const toRad = Math.PI / 180;
    const dLat = (lat2 - lat1) * toRad;
    const dLon = (lon2 - lon1) * toRad;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
}

// ── TEST EXECUTION ──
console.log("================================================================================");
console.log("             CARETRACK ENGINE VERIFICATION TEST SUITE                           ");
console.log("================================================================================\n");

const engine = new LocationEngineSimulation();
let failures = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    failures++;
  } else {
    console.log(`✅ PASS: ${message}`);
  }
}

let t = 0;
let lat = 6.42000, lng = 80.00000;

// Test 0: Initial rest at home
console.log("--- TEST 1: Initial Stationary at Start ---");
let r0 = engine.processFix({ timeSec: t++, lat, lng, rawGpsSpeedMps: 0.0, cadenceSpm: 0 });
assert(r0.activity === "still" && r0.speedKmh === 0, "Initial state is STILL at 0.0 km/h");

// Test 2: Car starts and drives to 50 km/h
console.log("\n--- TEST 2: Car Acceleration to 50 km/h ---");
let carSpeedMps = 0;
for (let i = 0; i < 5; i++) {
  t += 2;
  carSpeedMps = Math.min(14.0, carSpeedMps + 3.0); // Accelerate ~10 km/h per 2s
  lat += (carSpeedMps * 2) / 111000; // Physical displacement
  let res = engine.processFix({ timeSec: t, lat, lng, rawGpsSpeedMps: carSpeedMps, cadenceSpm: 0 });
  console.log(`  t=${t}s | RepSpeed: ${res.speedKmh} km/h | Act: ${res.activity} | Event: ${res.event}`);
}
assert(engine.currentActivityType === "in_vehicle", "Activity classified as IN_VEHICLE when driving");
assert(engine.currentEstimatedSpeed * 3.6 > 35.0, `Car speed reached ${+(engine.currentEstimatedSpeed * 3.6).toFixed(1)} km/h without being capped at 6.5 km/h`);

// Test 3: Car enters heavy traffic, crawling at 8 km/h and 4 km/h (cadence = 0)
console.log("\n--- TEST 3: Traffic Crawling (8 km/h & 4 km/h with Cadence = 0) ---");
for (let i = 0; i < 4; i++) {
  t += 2;
  carSpeedMps = 2.2; // 8 km/h
  lat += (carSpeedMps * 2) / 111000;
  let res = engine.processFix({ timeSec: t, lat, lng, rawGpsSpeedMps: carSpeedMps, cadenceSpm: 0 });
  console.log(`  t=${t}s (Traffic 8 km/h) | RepSpeed: ${res.speedKmh} km/h | Act: ${res.activity} | Event: ${res.event}`);
  assert(res.activity === "in_vehicle", `In traffic at 8 km/h, activity MUST remain IN_VEHICLE (got: ${res.activity})`);
}
for (let i = 0; i < 3; i++) {
  t += 2;
  carSpeedMps = 1.1; // 4 km/h (crawling)
  lat += (carSpeedMps * 2) / 111000;
  let res = engine.processFix({ timeSec: t, lat, lng, rawGpsSpeedMps: carSpeedMps, cadenceSpm: 0 });
  console.log(`  t=${t}s (Traffic 4 km/h) | RepSpeed: ${res.speedKmh} km/h | Act: ${res.activity} | Event: ${res.event}`);
  assert(res.activity === "in_vehicle", `In crawl at 4 km/h, activity MUST remain IN_VEHICLE (got: ${res.activity})`);
}

// Test 4: Car stops at Red Light
console.log("\n--- TEST 4: Car Stops at Red Light (5-Second Stillness Debounce) ---");
t += 2;
let rStop1 = engine.processFix({ timeSec: t, lat, lng, rawGpsSpeedMps: 0.0, cadenceSpm: 0 });
console.log(`  t=${t}s (Stopped 2s) | RepSpeed: ${rStop1.speedKmh} km/h | Act: ${rStop1.activity} | Event: ${rStop1.event}`);
assert(rStop1.event.includes("DECELERATING"), "At 2 seconds, stop is NOT prematurely locked");

t += 2; // t=29s (2s elapsed since t=27)
let rStop2 = engine.processFix({ timeSec: t, lat, lng, rawGpsSpeedMps: 0.0, cadenceSpm: 0 });
console.log(`  t=${t}s (2s elapsed) | RepSpeed: ${rStop2.speedKmh} km/h | Act: ${rStop2.activity} | Event: ${rStop2.event}`);
assert(rStop2.event.includes("DECELERATING"), "At 2 seconds elapsed, still decelerating in grace period");

t += 2; // t=31s (4s elapsed since t=27)
let rStop3 = engine.processFix({ timeSec: t, lat, lng, rawGpsSpeedMps: 0.0, cadenceSpm: 0 });
console.log(`  t=${t}s (4s elapsed) | RepSpeed: ${rStop3.speedKmh} km/h | Act: ${rStop3.activity} | Event: ${rStop3.event}`);
assert(rStop3.event.includes("DECELERATING"), "At 4 seconds elapsed, still in debounce grace period");

t += 2; // t=33s (6s elapsed since t=27, > 5.0s threshold!)
let rStop4 = engine.processFix({ timeSec: t, lat, lng, rawGpsSpeedMps: 0.0, cadenceSpm: 0 });
console.log(`  t=${t}s (6s elapsed) | RepSpeed: ${rStop4.speedKmh} km/h | Act: ${rStop4.activity} | Event: ${rStop4.event}`);
assert(rStop4.event === "STOP_CONFIRMED", "At 6 seconds (> 5s), RED LIGHT STOP IS CONFIRMED!");
assert(rStop4.activity === "still" && rStop4.speedKmh === 0, "Speed confirmed 0.0 km/h at red light");

// Stay stopped for 20 more seconds at the red light
for (let s = 0; s < 4; s++) {
  t += 3;
  let rStill = engine.processFix({ timeSec: t, lat, lng, rawGpsSpeedMps: 0.0, cadenceSpm: 0 });
}
assert(engine.currentActivityType === "still", "Maintains STILL throughout the red light duration");

// Test 8: Real-World GPS Jitter at Red Light (Multipath & Satellite Reflection)
console.log("\n--- TEST 8: Real-World GPS Jitter at Red Light (Scatter ±8m & Doppler Noise) ---");
const jitterEngine = new LocationEngineSimulation();
let jt = 0;
let jlat = 6.42500, jlng = 80.00500;
jitterEngine.processFix({ timeSec: jt++, lat: jlat, lng: jlng, rawGpsSpeedMps: 0.0, cadenceSpm: 0 });

// Car driving at 45 km/h
for (let i = 0; i < 4; i++) {
  jt += 2;
  jlat += 25.0 / 111000;
  jitterEngine.processFix({ timeSec: jt, lat: jlat, lng: jlng, rawGpsSpeedMps: 12.5, cadenceSpm: 0 });
}
assert(jitterEngine.currentActivityType === "in_vehicle", "Driving initially IN_VEHICLE");

// Now car stops at Red Light at coordinates (jlat, jlng)
const stopCenterLat = jlat;
const stopCenterLng = jlng;
console.log("  Car halted at red light. Simulating 10 fixes (20s) with GPS Jitter:");

let confirmedStops = 0;
for (let i = 1; i <= 10; i++) {
  jt += 2;
  // Real-world jitter: satellite scatter bouncing within ±8m radius, Doppler reporting 0.2 - 0.8 m/s (0.7 - 2.8 km/h)
  const jitterOffsetMeters = (Math.sin(i * 1.7) * 7.0); // Bounces between -7m and +7m
  const jitterLat = stopCenterLat + (jitterOffsetMeters / 111000);
  const jitterSpeedMps = Math.abs(Math.cos(i * 1.3)) * 0.7; // 0.0 to 2.5 km/h fake speed

  let res = jitterEngine.processFix({
    timeSec: jt,
    lat: jitterLat,
    lng: stopCenterLng,
    rawGpsSpeedMps: jitterSpeedMps,
    accuracy: 8.0,
    cadenceSpm: 0
  });

  console.log(`    Fix ${i} (t=${jt}s): JitterOffset=${jitterOffsetMeters.toFixed(1)}m | GpsSpd=${(jitterSpeedMps*3.6).toFixed(1)}km/h | RepSpeed=${res.speedKmh}km/h | Act=${res.activity} | Event=${res.event}`);
  if (res.event === "STOP_CONFIRMED" || res.activity === "still") {
    confirmedStops++;
  }
}

assert(confirmedStops >= 7, `GPS Jitter absorbed! Stop remained locked (${confirmedStops}/10 fixes remained STILL)`);
assert(jitterEngine.currentActivityType === "still", "Maintained STILL despite continuous ±8m satellite scatter");

// Test 5: Traffic Light Turns Green -> Acceleration
console.log("\n--- TEST 5: Green Light Acceleration (Vehicle Departure from Stop) ---");
carSpeedMps = 6.0; // 21.6 km/h first acceleration fix
t += 2;
lat += (carSpeedMps * 2) / 111000;
let rGreen1 = engine.processFix({ timeSec: t, lat, lng, rawGpsSpeedMps: carSpeedMps, cadenceSpm: 0 });
console.log(`  t=${t}s (Green Light) | RepSpeed: ${rGreen1.speedKmh} km/h | Act: ${rGreen1.activity}`);
assert(rGreen1.speedKmh > 10.0, `Green light acceleration is NOT capped at 6.5 km/h (speed=${rGreen1.speedKmh} km/h)`);

t += 2;
carSpeedMps = 13.0; // 46.8 km/h
lat += (carSpeedMps * 2) / 111000;
let rGreen2 = engine.processFix({ timeSec: t, lat, lng, rawGpsSpeedMps: carSpeedMps, cadenceSpm: 0 });
console.log(`  t=${t}s (Driving)     | RepSpeed: ${rGreen2.speedKmh} km/h | Act: ${rGreen2.activity}`);
assert(rGreen2.activity === "in_vehicle", "Cleanly re-establishes IN_VEHICLE");
assert(rGreen2.speedKmh > 30.0, `Speed cleanly reaches vehicular velocity (${rGreen2.speedKmh} km/h)`);

// Test 6: Momentary 1-second GPS Glitch / 0-speed blip on Highway
console.log("\n--- TEST 6: Single 1-Second 0-Speed Blip on Highway ---");
t += 1;
let rGlitch = engine.processFix({ timeSec: t, lat, lng, rawGpsSpeedMps: 0.0, cadenceSpm: 0 });
console.log(`  t=${t}s (1s Blip 0 km/h) | RepSpeed: ${rGlitch.speedKmh} km/h | Act: ${rGlitch.activity} | Event: ${rGlitch.event}`);
assert(engine.isCurrentlyMoving === true, "Single 1-second blip DOES NOT flip to stationary!");
assert(rGlitch.event !== "STOP_CONFIRMED", "Single 1-second blip does NOT trigger false STOP");

// Test 7: Walking Departure with 25.3 km/h Doppler Glitch (Cadence = 85 SPM)
console.log("\n--- TEST 7: Walking Departure with 25.3 km/h GPS Doppler Spike ---");
// Simulate coming to a 30-second stop at home, then walking
const walkEngine = new LocationEngineSimulation();
let wt = 0;
let wlat = 6.42500, wlng = 80.00500;
walkEngine.processFix({ timeSec: wt++, lat: wlat, lng: wlng, rawGpsSpeedMps: 0.0, cadenceSpm: 0 });

// 30s stop
wt += 30;
walkEngine.processFix({ timeSec: wt, lat: wlat, lng: wlng, rawGpsSpeedMps: 0.0, cadenceSpm: 0 });

// Now start walking: 85 steps/minute, but GPS hardware emits 7.02 m/s (25.3 km/h) Doppler spike!
wt += 2;
wlat += 2.0 / 111000; // Moved only 2 meters!
let rWalkSpike = walkEngine.processFix({
  timeSec: wt,
  lat: wlat,
  lng: wlng,
  rawGpsSpeedMps: 7.02, // 25.3 km/h spike from GPS hardware!
  cadenceSpm: 85        // Walking cadence!
});

console.log(`  Walking Fix | RepSpeed: ${rWalkSpike.speedKmh} km/h | Act: ${rWalkSpike.activity} | Event: ${rWalkSpike.event}`);
assert(rWalkSpike.activity === "walking", "Activity correctly detected as WALKING");
assert(rWalkSpike.speedKmh < 7.0, `Doppler spike 25.3 km/h successfully rejected! Clamped to walking pace (${rWalkSpike.speedKmh} km/h)`);

console.log("\n================================================================================");
if (failures === 0) {
  console.log("🎉 ALL TESTS PASSED PERFECTLY! 0 REGRESSIONS DETECTED.");
} else {
  console.error(`💥 ${failures} TEST(S) FAILED.`);
}
console.log("================================================================================");
