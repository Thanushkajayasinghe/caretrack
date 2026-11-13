/**
 * High-Performance Road Snapping Service
 *
 * Snaps raw/noisy GPS points cleanly onto real road centerlines.
 * 4-Tier Bulletproof Architecture:
 *   1. Tier 1: Mapbox Map Matching API (High accuracy, 100k free req/mo)
 *   2. Tier 2: OSRM Match API (/match/v1/driving)
 *   3. Tier 3: OSRM Route API (/route/v1/driving)
 *   4. Tier 4: Raw GPS Fallback (Instant offline / open field fallback)
 */

const MAPBOX_ACCESS_TOKEN = 'pk.eyJ1IjoiY2FydGpheWFzaW5naGUiLCJhIjoiY211NzZ1N2Y3MGNyMjJ4cTBjZXRwczdlNSJ9.r1Z2AAdMmyncIz4XaKGLGQ';
const OSRM_BASE_URL = 'https://router.project-osrm.org';
const snapCache = new Map();

/**
 * Snaps a list of GPS points to real road centerlines.
 * @param {Array<{lat: number, lng: number, speed?: number}>} points
 * @param {boolean} forceRaw - If true, bypasses map matching and returns raw points
 * @returns {Promise<Array<[number, number]>>} Array of [lat, lng] coordinates along roads
 */
export async function snapPointsToRoads(points, forceRaw = false) {
  if (!points || !Array.isArray(points) || points.length < 2 || forceRaw) {
    return (points || []).map((p) => [Number(p.lat ?? p[0]), Number(p.lng ?? p[1])]);
  }

  // Filter valid coordinates
  const valid = points.filter((p) => {
    const lat = Number(p.lat ?? p[0]);
    const lng = Number(p.lng ?? p[1]);
    return !isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0;
  });

  if (valid.length < 2) {
    return valid.map((p) => [Number(p.lat ?? p[0]), Number(p.lng ?? p[1])]);
  }

  // Cache key based on count, start, and end points
  const pStart = valid[0];
  const pEnd = valid[valid.length - 1];
  const cacheKey = `${valid.length}_${Number(pStart.lat ?? pStart[0]).toFixed(4)},${Number(pStart.lng ?? pStart[1]).toFixed(4)}_${Number(pEnd.lat ?? pEnd[0]).toFixed(4)},${Number(pEnd.lng ?? pEnd[1]).toFixed(4)}`;

  if (snapCache.has(cacheKey)) {
    return snapCache.get(cacheKey);
  }

  // Subsample points to stay within Mapbox / OSRM limits (max 80 points)
  const step = Math.max(1, Math.floor(valid.length / 70));
  const sampled = [];
  for (let i = 0; i < valid.length; i += step) {
    sampled.push(valid[i]);
  }
  if (sampled[sampled.length - 1] !== valid[valid.length - 1]) {
    sampled.push(valid[valid.length - 1]);
  }

  const coordString = sampled
    .map((p) => `${Number(p.lng ?? p[1]).toFixed(6)},${Number(p.lat ?? p[0]).toFixed(6)}`)
    .join(';');

  // ── Tier 1: Mapbox Map Matching API ──
  if (MAPBOX_ACCESS_TOKEN) {
    try {
      const mapboxUrl = `https://api.mapbox.com/matching/v5/mapbox/driving/${coordString}?geometries=geojson&overview=full&access_token=${MAPBOX_ACCESS_TOKEN}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3500);

      const res = await fetch(mapboxUrl, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json();
        if (data.code === 'Ok' && Array.isArray(data.matchings) && data.matchings.length > 0) {
          const snapped = [];
          for (const m of data.matchings) {
            if (m.geometry && Array.isArray(m.geometry.coordinates)) {
              for (const c of m.geometry.coordinates) {
                snapped.push([c[1], c[0]]); // GeoJSON [lng, lat] -> Leaflet [lat, lng]
              }
            }
          }
          if (snapped.length > 0) {
            snapCache.set(cacheKey, snapped);
            if (snapCache.size > 120) {
              const firstKey = snapCache.keys().next().value;
              snapCache.delete(firstKey);
            }
            return snapped;
          }
        }
      }
    } catch (mapboxErr) {
      // Fall through to Tier 2
    }
  }

  // ── Tier 2: OSRM Match API Fallback ──
  try {
    const matchUrl = `${OSRM_BASE_URL}/match/v1/driving/${coordString}?overview=full&geometries=geojson`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    const matchRes = await fetch(matchUrl, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (matchRes.ok) {
      const matchData = await matchRes.json();
      if (matchData.code === 'Ok' && Array.isArray(matchData.matchings) && matchData.matchings.length > 0) {
        const snapped = [];
        for (const m of matchData.matchings) {
          if (m.geometry && Array.isArray(m.geometry.coordinates)) {
            for (const c of m.geometry.coordinates) {
              snapped.push([c[1], c[0]]);
            }
          }
        }
        if (snapped.length > 0) {
          snapCache.set(cacheKey, snapped);
          return snapped;
        }
      }
    }
  } catch (matchErr) {
    // Fall through to Tier 3
  }

  // ── Tier 3: OSRM Route Fallback ──
  try {
    const routeStep = Math.max(1, Math.floor(sampled.length / 20));
    const routeSampled = [];
    for (let i = 0; i < sampled.length; i += routeStep) {
      routeSampled.push(sampled[i]);
    }
    if (routeSampled[routeSampled.length - 1] !== sampled[sampled.length - 1]) {
      routeSampled.push(sampled[sampled.length - 1]);
    }

    const routeCoordString = routeSampled
      .map((p) => `${Number(p.lng ?? p[1]).toFixed(6)},${Number(p.lat ?? p[0]).toFixed(6)}`)
      .join(';');

    const routeUrl = `${OSRM_BASE_URL}/route/v1/driving/${routeCoordString}?overview=full&geometries=geojson`;
    const routeController = new AbortController();
    const routeTimeoutId = setTimeout(() => routeController.abort(), 3000);

    const routeRes = await fetch(routeUrl, { signal: routeController.signal });
    clearTimeout(routeTimeoutId);

    if (routeRes.ok) {
      const routeData = await routeRes.json();
      if (routeData.code === 'Ok' && Array.isArray(routeData.routes) && routeData.routes.length > 0) {
        const routeCoords = routeData.routes[0].geometry.coordinates.map((c) => [c[1], c[0]]);
        if (routeCoords.length > 0) {
          snapCache.set(cacheKey, routeCoords);
          return routeCoords;
        }
      }
    }
  } catch (routeErr) {
    // Fall through to Tier 4
  }

  // ── Tier 4: Instant Raw GPS Fallback ──
  return valid.map((p) => [Number(p.lat ?? p[0]), Number(p.lng ?? p[1])]);
}
