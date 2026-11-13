/**
 * CareTrack Trip & Stop Segmentation Engine
 *
 * Implements the 5-minute / 40-meter dwell standard (used in Google Maps Timeline & Life360)
 * to partition raw location history into chronological Trips and Stops.
 */

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // meters
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

const STOP_RADIUS_METERS = 40.0;
const STOP_MIN_DURATION_MS = 5 * 60 * 1000; // 5 minutes
const GAP_SPLIT_DISTANCE_METERS = 400.0;
const GAP_SPLIT_TIME_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Segments an array of location points into an ordered timeline of Trips and Stops.
 *
 * @param {Array} points - Array of { lat, lng, speed, recorded_at, accuracy }
 * @returns {Array} timeline items of type 'trip' or 'stop'
 */
export function segmentHistoryPoints(points) {
  if (!Array.isArray(points) || points.length === 0) {
    return { timeline: [], trips: [], stops: [] };
  }

  // Ensure chronological ordering
  const sorted = [...points].sort(
    (a, b) => new Date(a.recorded_at) - new Date(b.recorded_at)
  );

  const n = sorted.length;
  if (n === 1) {
    const single = sorted[0];
    const item = {
      type: 'stop',
      id: 'stop-0',
      startTime: new Date(single.recorded_at),
      endTime: new Date(single.recorded_at),
      durationMs: 0,
      lat: Number(single.lat),
      lng: Number(single.lng),
      points: [single],
    };
    return { timeline: [item], trips: [], stops: [item] };
  }

  // 1. Identify Stationary Clusters (Stops)
  // A stop is defined as >= 5 minutes where all points stay within 40m of an anchor point
  const stopSpans = []; // { startIdx, endIdx, startTime, endTime, lat, lng }
  let i = 0;

  while (i < n) {
    const anchor = sorted[i];
    let j = i + 1;
    let clusterMaxDist = 0;

    while (j < n) {
      const candidate = sorted[j];
      const distFromAnchor = haversine(
        Number(anchor.lat),
        Number(anchor.lng),
        Number(candidate.lat),
        Number(candidate.lng)
      );

      if (distFromAnchor > STOP_RADIUS_METERS) {
        // Left the 40m radius
        break;
      }
      clusterMaxDist = Math.max(clusterMaxDist, distFromAnchor);
      j++;
    }

    const duration =
      new Date(sorted[j - 1].recorded_at) - new Date(sorted[i].recorded_at);

    if (duration >= STOP_MIN_DURATION_MS) {
      // Calculate centroid of the stop
      let sumLat = 0;
      let sumLng = 0;
      for (let k = i; k < j; k++) {
        sumLat += Number(sorted[k].lat);
        sumLng += Number(sorted[k].lng);
      }
      stopSpans.push({
        startIdx: i,
        endIdx: j - 1,
        startTime: new Date(sorted[i].recorded_at),
        endTime: new Date(sorted[j - 1].recorded_at),
        durationMs: duration,
        lat: sumLat / (j - i),
        lng: sumLng / (j - i),
        points: sorted.slice(i, j),
      });
      i = j;
    } else {
      i++;
    }
  }

  // 2. Build Timeline by filling in movement blocks (Trips) between stops
  const timeline = [];
  let lastCoveredIdx = 0;
  let tripCounter = 1;
  let stopCounter = 1;

  function buildTrip(pts) {
    if (pts.length === 0) return null;

    let distanceMeters = 0;
    let maxSpeedMps = 0;
    let speedSum = 0;
    let speedCount = 0;

    const startPt = pts[0];
    let maxRadiusMeters = 0;

    for (let p = 0; p < pts.length; p++) {
      let spd = Number(pts[p].speed || 0);
      if (p > 0) {
        const dPrev = haversine(Number(pts[p - 1].lat), Number(pts[p - 1].lng), Number(pts[p].lat), Number(pts[p].lng));
        const dt = Math.max(0.5, (new Date(pts[p].recorded_at) - new Date(pts[p - 1].recorded_at)) / 1000);
        const spatialSpeed = dPrev / dt;
        if (spd > 2.2 && (dPrev < 25.0 || spatialSpeed < 2.0)) {
          spd = Math.min(spd, Math.max(spatialSpeed, 1.4));
        }
      }
      if (spd > maxSpeedMps) maxSpeedMps = spd;
      if (spd > 0) {
        speedSum += spd;
        speedCount++;
      }
      const r = haversine(
        Number(startPt.lat),
        Number(startPt.lng),
        Number(pts[p].lat),
        Number(pts[p].lng)
      );
      if (r > maxRadiusMeters) maxRadiusMeters = r;

      if (p > 0) {
        distanceMeters += haversine(
          Number(pts[p - 1].lat),
          Number(pts[p - 1].lng),
          Number(pts[p].lat),
          Number(pts[p].lng)
        );
      }
    }

    const netDisplacementMeters = haversine(
      Number(pts[0].lat),
      Number(pts[0].lng),
      Number(pts[pts.length - 1].lat),
      Number(pts[pts.length - 1].lng)
    );

    // ANTI-JITTER FILTER: A real Trip must actually depart from its origin!
    // A trip requires at least 25m of cumulative distance AND at least 18m net departure from origin!
    // Anything smaller (e.g. 10m desk/couch jitter) is stationary dwelling / stay, NOT a trip!
    if (distanceMeters < 25.0 || netDisplacementMeters < 18.0 || maxRadiusMeters < 18.0) {
      return null;
    }

    const startTime = new Date(pts[0].recorded_at);
    const endTime = new Date(pts[pts.length - 1].recorded_at);
    const durationMs = Math.max(1000, endTime - startTime);
    const maxSpeedKmh = maxSpeedMps * 3.6;
    const avgSpeedKmh = speedCount > 0 ? (speedSum / speedCount) * 3.6 : (distanceMeters / (durationMs / 1000)) * 3.6;

    // Detect travel mode (requires sustained speed or sufficient distance to prevent momentary GPS multipath spikes from misclassifying)
    let mode = 'walking';
    let modeIcon = 'walk-outline';
    let modeLabel = 'Walking';
    let modeEmoji = '🚶';

    if (avgSpeedKmh >= 15.0 || (maxSpeedKmh >= 22.0 && distanceMeters >= 100.0)) {
      mode = 'in_vehicle';
      modeIcon = 'car-outline';
      modeLabel = 'In Vehicle';
      modeEmoji = '🚗';
    } else if (avgSpeedKmh >= 8.5 || (maxSpeedKmh >= 12.0 && distanceMeters >= 70.0)) {
      mode = 'on_bicycle';
      modeIcon = 'bicycle-outline';
      modeLabel = 'Cycling';
      modeEmoji = '🚴';
    } else if (avgSpeedKmh >= 7.2 || (maxSpeedKmh >= 8.5 && distanceMeters >= 80.0)) {
      mode = 'running';
      modeIcon = 'fitness-outline';
      modeLabel = 'Running';
      modeEmoji = '🏃';
    }

    return {
      type: 'trip',
      id: `trip-${tripCounter++}`,
      tripIndex: tripCounter - 1,
      title: `Trip ${tripCounter - 1}`,
      startTime,
      endTime,
      durationMs,
      distanceMeters,
      maxSpeedKmh,
      avgSpeedKmh,
      mode,
      modeIcon,
      modeLabel,
      modeEmoji,
      points: pts,
    };
  }

  // Interleave trips and stops
  for (const stop of stopSpans) {
    if (stop.startIdx > lastCoveredIdx) {
      // Points between last stop and this stop form a Trip
      const movingPts = sorted.slice(lastCoveredIdx, stop.startIdx);
      if (movingPts.length >= 2) {
        // Split on large gaps (>400m or >15 mins)
        let subStart = 0;
        for (let s = 1; s < movingPts.length; s++) {
          const d = haversine(
            Number(movingPts[s - 1].lat),
            Number(movingPts[s - 1].lng),
            Number(movingPts[s].lat),
            Number(movingPts[s].lng)
          );
          const dt =
            new Date(movingPts[s].recorded_at) -
            new Date(movingPts[s - 1].recorded_at);

          if (d > GAP_SPLIT_DISTANCE_METERS || dt > GAP_SPLIT_TIME_MS) {
            const subTrip = buildTrip(movingPts.slice(subStart, s));
            if (subTrip && subTrip.distanceMeters >= 25.0) {
              timeline.push(subTrip);
            }
            subStart = s;
          }
        }
        const finalSubTrip = buildTrip(movingPts.slice(subStart));
        if (finalSubTrip && finalSubTrip.distanceMeters >= 25.0) {
          timeline.push(finalSubTrip);
        }
      }
    }

    timeline.push({
      type: 'stop',
      id: `stop-${stopCounter++}`,
      title: `Stop ${stopCounter - 1}`,
      startTime: stop.startTime,
      endTime: stop.endTime,
      durationMs: stop.durationMs,
      lat: stop.lat,
      lng: stop.lng,
      points: stop.points,
    });

    lastCoveredIdx = stop.endIdx + 1;
  }

  // Trailing points after the last stop
  if (lastCoveredIdx < n) {
    const trailingPts = sorted.slice(lastCoveredIdx);
    if (trailingPts.length >= 2) {
      const trip = buildTrip(trailingPts);
      if (trip && trip.distanceMeters >= 25.0) {
        timeline.push(trip);
      }
    }
  }

  // If no stops were found, whole range might be one or more trips or a stationary stay
  if (timeline.length === 0 && n >= 2) {
    const fullTrip = buildTrip(sorted);
    if (fullTrip && fullTrip.distanceMeters >= 25.0) {
      timeline.push(fullTrip);
    } else {
      // Less than 45m radius -> classify as a Stay / Stop, not a trip!
      let sumLat = 0;
      let sumLng = 0;
      for (const p of sorted) {
        sumLat += Number(p.lat);
        sumLng += Number(p.lng);
      }
      const singleStop = {
        type: 'stop',
        id: `stop-${stopCounter++}`,
        title: 'Stay',
        startTime: new Date(sorted[0].recorded_at),
        endTime: new Date(sorted[n - 1].recorded_at),
        durationMs: Math.max(1000, new Date(sorted[n - 1].recorded_at) - new Date(sorted[0].recorded_at)),
        lat: sumLat / n,
        lng: sumLng / n,
        points: sorted,
      };
      timeline.push(singleStop);
    }
  }

  const trips = timeline.filter((t) => t.type === 'trip');
  const stops = timeline.filter((t) => t.type === 'stop');

  return { timeline, trips, stops };
}
