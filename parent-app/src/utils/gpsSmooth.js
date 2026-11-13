/**
 * GPS Trail Smoothing Utility
 *
 * Two-stage pipeline (pure JS, zero dependencies, works offline):
 *   1. Douglas-Peucker  – removes redundant/noisy GPS points
 *   2. Catmull-Rom spline – generates smooth curve through remaining points
 *
 * Speed values from original GPS points are preserved and mapped onto
 * the interpolated coordinates so speed-colour rendering still works.
 *
 * Backup: original road snapping kept at src/services/roadSnapping.js
 */

// ─── Stage 1: Douglas-Peucker simplification ─────────────────────────────────

/** Perpendicular distance from point P to line segment AB (in metres approx) */
function perpendicularDistance(P, A, B) {
  const dx = B.lat - A.lat;
  const dy = B.lng - A.lng;
  if (dx === 0 && dy === 0) {
    const dLat = (P.lat - A.lat) * 111000;
    const dLng = (P.lng - A.lng) * 111000 * Math.cos((P.lat * Math.PI) / 180);
    return Math.hypot(dLat, dLng);
  }
  const t = ((P.lat - A.lat) * dx + (P.lng - A.lng) * dy) / (dx * dx + dy * dy);
  const closestLat = A.lat + t * dx;
  const closestLng = A.lng + t * dy;
  const dLat = (P.lat - closestLat) * 111000;
  const dLng = (P.lng - closestLng) * 111000 * Math.cos((P.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}

function douglasPeucker(pts, toleranceMetres) {
  if (pts.length <= 2) return pts;
  let maxDist = 0;
  let maxIdx = 0;
  const first = pts[0];
  const last  = pts[pts.length - 1];
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpendicularDistance(pts[i], first, last);
    if (d > maxDist) { maxDist = d; maxIdx = i; }
  }
  if (maxDist > toleranceMetres) {
    const left  = douglasPeucker(pts.slice(0, maxIdx + 1), toleranceMetres);
    const right = douglasPeucker(pts.slice(maxIdx), toleranceMetres);
    return left.slice(0, -1).concat(right);
  }
  return [first, last];
}

// ─── Stage 2: Catmull-Rom spline interpolation ───────────────────────────────

function catmullRom1D(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (
    2 * p1 +
    (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  );
}

function interpolateSegment(p0, p1, p2, p3, steps) {
  const result = [];
  for (let i = 0; i < steps; i++) {
    const t = i / steps;
    result.push({
      lat:   catmullRom1D(p0.lat, p1.lat, p2.lat, p3.lat, t),
      lng:   catmullRom1D(p0.lng, p1.lng, p2.lng, p3.lng, t),
      speed: p1.speed ?? 0, // inherit speed from the "from" point
    });
  }
  return result;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Smooth an array of GPS points using Douglas-Peucker + Catmull-Rom spline.
 *
 * Input:  Array of {lat, lng, speed?, ...}   (raw GPS points)
 * Output: Array of {lat, lng, speed}          (smooth, ready for map rendering)
 *
 * Falls back to original points safely if anything goes wrong.
 *
 * @param {Array<{lat: number, lng: number, speed?: number}>} points
 * @param {{ toleranceMetres?: number, splineSteps?: number }} options
 *   toleranceMetres – DP threshold; points within this distance of the
 *                     line are removed. Default 8m (good for child tracking).
 *   splineSteps     – interpolated points per GPS segment. Default 8.
 * @returns {Array<{lat: number, lng: number, speed: number}>}
 */
export function smoothGPSTrail(points, { toleranceMetres = 8, splineSteps = 8 } = {}) {
  try {
    if (!points || points.length < 2) return points ?? [];

    // Filter out invalid/zero coordinates
    const valid = points.filter(
      (p) => p && !isNaN(Number(p.lat)) && !isNaN(Number(p.lng))
              && Number(p.lat) !== 0 && Number(p.lng) !== 0
    );
    if (valid.length < 2) return valid;

    // Stage 1 – remove redundant noisy points
    const simplified = douglasPeucker(valid, toleranceMetres);
    if (simplified.length < 2) return valid;

    // Stage 2 – smooth curve through remaining points
    const smoothed = [];
    for (let i = 0; i < simplified.length - 1; i++) {
      const p0 = simplified[Math.max(0, i - 1)];
      const p1 = simplified[i];
      const p2 = simplified[i + 1];
      const p3 = simplified[Math.min(simplified.length - 1, i + 2)];
      smoothed.push(...interpolateSegment(p0, p1, p2, p3, splineSteps));
    }

    // Always close with the final original point
    const last = simplified[simplified.length - 1];
    smoothed.push({ lat: last.lat, lng: last.lng, speed: last.speed ?? 0 });

    return smoothed;
  } catch (err) {
    // Safety net: if smoothing fails for any reason, return raw GPS untouched
    console.warn('[gpsSmooth] Smoothing failed, using raw GPS:', err?.message);
    return points;
  }
}
