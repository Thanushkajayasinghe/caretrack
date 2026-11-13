import React, { useRef, useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

function buildStaticHtml() {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <style>
    * { -webkit-tap-highlight-color: transparent; box-sizing: border-box; }
    html, body, #map { margin: 0; padding: 0; width: 100%; height: 100%; background: #0A0E1A; }
    .leaflet-control-attribution, .leaflet-control-zoom { display: none !important; }
    .leaflet-tile-pane, .leaflet-overlay-pane, .leaflet-pane { will-change: transform; }
    .leaflet-overlay-pane svg, .leaflet-overlay-pane canvas { overflow: visible !important; }

    /* Floating action controls (top-right) */
    .map-controls {
      position: absolute;
      top: 12px;
      right: 12px;
      z-index: 999;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .map-ctrl-btn {
      background: rgba(31, 41, 55, 0.88);
      color: #F3F4F6;
      border: 1px solid rgba(255, 255, 255, 0.18);
      border-radius: 8px;
      padding: 6px 10px;
      font-family: -apple-system, sans-serif;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 4px;
      box-shadow: 0 4px 10px rgba(0,0,0,0.4);
      backdrop-filter: blur(8px);
      user-select: none;
    }
    .map-ctrl-btn:active {
      background: rgba(108, 99, 255, 0.85);
      color: #fff;
    }

    /* Floating Speed Legend (top-left) - single row */
    .speed-legend {
      position: absolute;
      top: 12px;
      left: 12px;
      z-index: 999;
      background: rgba(17, 24, 39, 0.88);
      backdrop-filter: blur(10px);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 20px;
      padding: 5px 10px;
      font-family: -apple-system, sans-serif;
      box-shadow: 0 4px 14px rgba(0,0,0,0.5);
      pointer-events: none;
      display: flex;
      flex-direction: row;
      align-items: center;
      gap: 10px;
    }
    .legend-item {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 10px;
      color: #E5E7EB;
      font-weight: 600;
      white-space: nowrap;
    }
    .legend-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      display: inline-block;
      flex-shrink: 0;
    }
    .legend-sep {
      width: 1px;
      height: 12px;
      background: rgba(255,255,255,0.15);
    }

    .start-badge {
      display: flex; align-items: center; gap: 4px;
      background: #10B981; color: #fff;
      font-family: -apple-system, sans-serif;
      font-size: 11px; font-weight: 700;
      padding: 3px 8px; border-radius: 12px;
      border: 2px solid #fff; box-shadow: 0 3px 8px rgba(0,0,0,0.4);
      white-space: nowrap;
    }

    .end-badge {
      display: flex; align-items: center; gap: 4px;
      background: #EF4444; color: #fff;
      font-family: -apple-system, sans-serif;
      font-size: 11px; font-weight: 700;
      padding: 3px 8px; border-radius: 12px;
      border: 2px solid #fff; box-shadow: 0 3px 8px rgba(0,0,0,0.4);
      white-space: nowrap;
    }

    .stay-badge {
      display: flex; align-items: center; gap: 4px;
      background: rgba(108, 99, 255, 0.95); color: #fff;
      font-family: -apple-system, sans-serif;
      font-size: 11px; font-weight: 700;
      padding: 4px 10px; border-radius: 14px;
      border: 2px solid #fff; box-shadow: 0 3px 10px rgba(0,0,0,0.45);
      white-space: nowrap;
      cursor: pointer;
    }

    /* Smooth moving playback marker */
    .smooth-moving-marker {
      transition: transform 0.22s linear !important;
      will-change: transform;
    }

    .moving-marker-wrap {
      position: relative;
      width: 44px; height: 44px;
      display: flex; align-items: center; justify-content: center;
    }

    .pulse-ring {
      position: absolute;
      width: 44px; height: 44px;
      border-radius: 50%;
      background: rgba(16, 185, 129, 0.4);
      animation: pulse 1.4s infinite ease-out;
      transition: background 0.3s ease;
    }

    .moving-core {
      position: relative;
      width: 32px; height: 32px;
      border-radius: 16px;
      background: linear-gradient(135deg, #10B981, #059669);
      color: #fff;
      display: flex; align-items: center; justify-content: center;
      font-size: 16px;
      border: 2.5px solid #fff;
      box-shadow: 0 4px 12px rgba(16, 185, 129, 0.6);
      transition: background 0.3s ease, box-shadow 0.3s ease;
    }

    @keyframes pulse {
      0% { transform: scale(0.6); opacity: 1; }
      100% { transform: scale(1.4); opacity: 0; }
    }

    /* Popup style */
    .leaflet-popup-content-wrapper {
      background: #1F2937;
      color: #F3F4F6;
      border-radius: 10px;
      padding: 4px;
      box-shadow: 0 4px 14px rgba(0,0,0,0.5);
      font-family: -apple-system, sans-serif;
      font-size: 12px;
      border: 1px solid rgba(255,255,255,0.15);
    }
    .leaflet-popup-tip { background: #1F2937; }
  </style>
</head>
<body>
  <div id="map"></div>

  <!-- Speed legend on top-left - single row -->
  <div class="speed-legend">
    <div class="legend-item">
      <span class="legend-dot" style="background:#10B981; box-shadow:0 0 5px #10B981;"></span>
      <span>&lt;7 km/h</span>
    </div>
    <div class="legend-sep"></div>
    <div class="legend-item">
      <span class="legend-dot" style="background:#F59E0B; box-shadow:0 0 5px #F59E0B;"></span>
      <span>7–25 km/h</span>
    </div>
    <div class="legend-sep"></div>
    <div class="legend-item">
      <span class="legend-dot" style="background:#EF4444; box-shadow:0 0 5px #EF4444;"></span>
      <span>&gt;25 km/h</span>
    </div>
  </div>

  <!-- Action controls on top-right -->
  <div class="map-controls">
    <button class="map-ctrl-btn" onclick="zoomToPointer(20)">🎯 Focus</button>
    <button class="map-ctrl-btn" onclick="fitRouteBounds()">🗺️ Overview</button>
    <button class="map-ctrl-btn" id="gotoBtn" onclick="goToCurrent()" style="display:none;">📍 Jump To</button>
  </div>

  <script>
    var map = null;
    var canvasRenderer = null;
    var trailSegmentsGroup = null;
    var roadGroup = null;
    var playedTrail = null;
    var startMarker = null;
    var endMarker = null;
    var movingMarker = null;
    var pointCircles = [];
    var points = [];
    var currentIdx = 0;
    var autoFollow = true;
    var isProgrammaticMove = false;

    function setAutoFollow(active) {
      autoFollow = !!active;
      var btn = document.getElementById('gotoBtn');
      if (btn) {
        if (autoFollow) {
          btn.style.background = 'rgba(31, 41, 55, 0.88)';
          btn.style.borderColor = 'rgba(255, 255, 255, 0.18)';
          btn.style.boxShadow = '0 4px 10px rgba(0,0,0,0.4)';
          btn.style.color = '#F3F4F6';
        } else {
          // Highlight Jump To button when user panned away to indicate tap to re-center & resume follow
          btn.style.background = 'rgba(99, 102, 241, 0.95)';
          btn.style.borderColor = '#818CF8';
          btn.style.boxShadow = '0 0 14px rgba(99, 102, 241, 0.7)';
          btn.style.color = '#FFFFFF';
        }
      }
    }
    window.setAutoFollow = setAutoFollow;

    function getSpeedColor(speedMs) {
      var kmh = (speedMs != null ? Number(speedMs) : 0) * 3.6;
      if (kmh < 7.0) return '#10B981'; // Emerald Green (< 7 km/h, Walking / Stroll)
      if (kmh < 25.0) return '#F59E0B'; // Warm Amber (7 - 25 km/h, Run / Cycling)
      return '#EF4444'; // Vivid Red (> 25 km/h, Vehicle Transit)
    }

    function getSpeedCategory(speedMs) {
      var kmh = (speedMs != null ? Number(speedMs) : 0) * 3.6;
      if (kmh < 7.0) return 'Walking';
      if (kmh < 25.0) return 'Running/Cycling';
      return 'Vehicle';
    }

    function initMap() {
      try {
        canvasRenderer = L.canvas({ padding: 0.5 });
        map = L.map('map', {
          center: [6.4157, 80.0008],
          zoom: 16,
          maxZoom: 20,
          zoomControl: false,
          attributionControl: false,
          preferCanvas: true,
          renderer: canvasRenderer
        });

        var tileL = L.tileLayer('${TILE_URL}', {
          maxZoom: 20,
          maxNativeZoom: 19,
          subdomains: ['a', 'b', 'c'],
          keepBuffer: 12,
          updateWhenIdle: false,
          updateWhenPanning: true,
          updateInterval: 100,
          crossOrigin: true
        }).addTo(map);

        tileL.on('tileerror', function(error, tile) {
          if (!tile._retryCount) {
            tile._retryCount = 1;
            setTimeout(function() {
              if (tile && tile.src) {
                var base = tile.src.split('?')[0];
                tile.src = base + '?r=' + Date.now();
              }
            }, 500);
          }
        });

        trailSegmentsGroup = L.featureGroup().addTo(map);
        roadGroup = L.featureGroup().addTo(map);

        // Auto-follow: pause when user manually drags or zooms the map
        map.on('dragstart', function() {
          setAutoFollow(false);
        });

        map.on('zoomstart', function() {
          if (!isProgrammaticMove) {
            setAutoFollow(false);
          }
        });

        var mapDiv = document.getElementById('map');
        if (mapDiv) {
          mapDiv.addEventListener('touchstart', function(e) {
            if (e.touches && e.touches.length > 1) {
              setAutoFollow(false);
            }
          }, { passive: true });
          mapDiv.addEventListener('wheel', function() {
            setAutoFollow(false);
          }, { passive: true });
        }

        if (points && points.length > 0) {
          renderRoute();
        }

        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ready' }));
        }
      } catch(e) {
        console.error('initMap error:', e);
      }
    }

    function renderRoute() {
      try {
        if (!map) return;

        // Clear previous layers
        if (trailSegmentsGroup) { trailSegmentsGroup.clearLayers(); }
        if (roadGroup) { roadGroup.clearLayers(); }
        if (playedTrail) { map.removeLayer(playedTrail); playedTrail = null; }
        if (startMarker) { map.removeLayer(startMarker); startMarker = null; }
        if (endMarker) { map.removeLayer(endMarker); endMarker = null; }
        if (movingMarker) { map.removeLayer(movingMarker); movingMarker = null; }
        pointCircles.forEach(function(c) { map.removeLayer(c); });
        pointCircles = [];

        if (!points || !Array.isArray(points) || points.length === 0) return;

        var validPoints = [];
        for (var i = 0; i < points.length; i++) {
          var p = points[i];
          var lat = Number(p.lat);
          var lng = Number(p.lng);
          if (!isNaN(lat) && !isNaN(lng)) {
            validPoints.push(p);
          }
        }

        if (validPoints.length === 0) return;
        var latLngs = validPoints.map(function(p) { return [Number(p.lat), Number(p.lng)]; });

        if (validPoints.length === 1) {
          var singlePt = validPoints[0];
          startMarker = L.marker([Number(singlePt.lat), Number(singlePt.lng)], {
            icon: L.divIcon({
              className: '',
              html: '<div class="start-badge" style="background:#6C63FF; padding: 4px 10px;"><span>📍</span><span>Location</span></div>',
              iconSize: [120, 26],
              iconAnchor: [60, 13]
            }),
            zIndexOffset: 500
          }).addTo(map);

          map.setView([Number(singlePt.lat), Number(singlePt.lng)], 17);
          return;
        }

        // 1. SPEED-COLOR-CODED ROUTE SEGMENTS
        // Each segment between consecutive points is colored based on that segment's real speed
        for (var s = 0; s < validPoints.length - 1; s++) {
          var pA = validPoints[s];
          var pB = validPoints[s + 1];
          var latLngA = [Number(pA.lat), Number(pA.lng)];
          var latLngB = [Number(pB.lat), Number(pB.lng)];

          var d = L.latLng(latLngA).distanceTo(L.latLng(latLngB));
          var dt = (pA.recorded_at && pB.recorded_at) ? Math.abs(new Date(pB.recorded_at) - new Date(pA.recorded_at)) / 1000.0 : 0;
          if (d > 350.0 || (dt > 0 && dt > 600.0)) {
            // Gap between distinct trips or lost signal - do not connect across the map
            continue;
          }

          // Derive speed for this segment
          var spd = Math.max(Number(pA.speed || 0), Number(pB.speed || 0));
          if (spd <= 0 && dt >= 0.5 && dt <= 180.0 && d >= 25.0) {
            spd = Math.min(d / dt, 30.0);
          } else if (d < 25.0) {
            spd = 0;
          }
          var segColor = getSpeedColor(spd);

          // Outer halo line for contrast
          L.polyline([latLngA, latLngB], {
            renderer: canvasRenderer,
            color: '#0A0E1A',
            weight: 8,
            opacity: 0.65,
            lineCap: 'round',
            lineJoin: 'round'
          }).addTo(trailSegmentsGroup);

          // Colored speed polyline segment
          L.polyline([latLngA, latLngB], {
            renderer: canvasRenderer,
            color: segColor,
            weight: 5.5,
            opacity: 0.95,
            lineCap: 'round',
            lineJoin: 'round'
          }).addTo(trailSegmentsGroup);
        }

        // 2. Played Trail Line (highlights progress during animation)
        playedTrail = L.polyline([latLngs[0]], {
          renderer: canvasRenderer,
          color: '#3B82F6',
          weight: 4,
          opacity: 0.9,
          lineJoin: 'round'
        }).addTo(map);

        // 3. Intermediate Clickable Waypoint Dots & Clean Stay Badges
        // Pre-identify stationary clusters (points within 35m for >= 5 minutes)
        // Collapses 100+ overlapping dots into 1 single Stay badge!
        var inStayCluster = new Array(validPoints.length).fill(false);
        var stayMarkers = [];
        var k = 0;
        while (k < validPoints.length) {
          var anchorPt = validPoints[k];
          var m = k + 1;
          while (m < validPoints.length) {
            var cand = validPoints[m];
            var d = L.latLng([Number(anchorPt.lat), Number(anchorPt.lng)]).distanceTo(L.latLng([Number(cand.lat), Number(cand.lng)]));
            if (d > 35.0) break;
            m++;
          }
          var stayDt = (m > k + 1 && anchorPt.recorded_at && validPoints[m - 1].recorded_at)
            ? (new Date(validPoints[m - 1].recorded_at) - new Date(anchorPt.recorded_at))
            : 0;
          if (stayDt >= 5 * 60 * 1000) {
            // Mark these points as part of a stay cluster
            for (var c = k; c < m; c++) {
              inStayCluster[c] = true;
            }
            var totalMins = Math.round(stayDt / 60000);
            var durStr = totalMins < 60 ? (totalMins + 'm') : (Math.floor(totalMins / 60) + 'h ' + (totalMins % 60 > 0 ? (totalMins % 60 + 'm') : ''));
            var midPt = validPoints[Math.floor((k + m - 1) / 2)];
            stayMarkers.push({
              latLng: [Number(midPt.lat), Number(midPt.lng)],
              label: '📍 Stayed ' + durStr,
              firstIndex: k
            });
            k = m;
          } else {
            k++;
          }
        }

        // Render Clean Stay Badges
        stayMarkers.forEach(function(stay) {
          var sm = L.marker(stay.latLng, {
            icon: L.divIcon({
              className: '',
              html: '<div class="stay-badge"><span>' + stay.label + '</span></div>',
              iconSize: [110, 26],
              iconAnchor: [55, 13]
            }),
            zIndexOffset: 450
          }).addTo(map);
          sm.on('click', function() {
            setIndex(stay.firstIndex, true);
          });
          pointCircles.push(sm);
        });

        // Render moving waypoint dots with distance spacing (min 25m apart)
        var lastDotLatLng = null;
        for (var i = 0; i < validPoints.length; i++) {
          if (inStayCluster[i]) continue;

          var p = validPoints[i];
          var lat = Number(p.lat);
          var lng = Number(p.lng);
          var curLatLng = L.latLng([lat, lng]);

          if (lastDotLatLng != null) {
            var distFromLastDot = lastDotLatLng.distanceTo(curLatLng);
            if (distFromLastDot < 25.0 && i < validPoints.length - 1) {
              continue;
            }
          }

          lastDotLatLng = curLatLng;
          var dotColor = getSpeedColor(p.speed);
          var dotSpeedKmh = ((Number(p.speed) || 0) * 3.6).toFixed(1);
          var dotCategory = getSpeedCategory(p.speed);

          var circle = L.circleMarker([lat, lng], {
            radius: 5,
            color: '#FFFFFF',
            fillColor: dotColor,
            fillOpacity: 1.0,
            weight: 2
          }).addTo(map);

          (function(idx) {
            var timeStr = p.recorded_at ? new Date(p.recorded_at).toLocaleTimeString() : '';
            var popupContent = '<div style="min-width: 140px; font-family: -apple-system, sans-serif;">' +
              '<div style="font-weight: 700; color: #FFFFFF; font-size: 12px; margin-bottom: 3px;">Point #' + (idx + 1) + '</div>' +
              '<div style="color: #9CA3AF; font-size: 11px; margin-bottom: 5px;">' + timeStr + '</div>' +
              '<div style="display: flex; align-items: center; gap: 6px;">' +
                '<span style="display: inline-block; width: 9px; height: 9px; border-radius: 5px; background:' + dotColor + ';"></span>' +
                '<span style="font-weight: 700; color:' + dotColor + '; font-size: 12px;">' + dotSpeedKmh + ' km/h</span>' +
                '<span style="color: #9CA3AF; font-size: 10px;">(' + dotCategory + ')</span>' +
              '</div>' +
            '</div>';

            circle.bindPopup(popupContent);
            circle.on('click', function() {
              setIndex(idx, true);
            });
          })(i);

          pointCircles.push(circle);
        }

        var totalDistMeters = 0;
        for (var k = 0; k < latLngs.length - 1; k++) {
          totalDistMeters += L.latLng(latLngs[k]).distanceTo(L.latLng(latLngs[k + 1]));
        }
        var netDistMeters = L.latLng(latLngs[0]).distanceTo(L.latLng(latLngs[latLngs.length - 1]));
        var isStationaryStay = (totalDistMeters < 30.0 && netDistMeters < 25.0);

        if (isStationaryStay) {
          // Stationary dwell / at home: show ONE single location marker, no start/finish flags
          startMarker = L.marker(latLngs[latLngs.length - 1], {
            icon: L.divIcon({
              className: '',
              html: '<div class="start-badge" style="background:#6C63FF; padding: 4px 10px;"><span>📍</span><span>Stationary</span></div>',
              iconSize: [120, 26],
              iconAnchor: [60, 13]
            }),
            zIndexOffset: 500
          }).addTo(map);

          map.setView(latLngs[latLngs.length - 1], 17);
          return;
        }

        var isSmallRoute = latLngs.length <= 1 || (Math.abs(latLngs[0][0] - latLngs[latLngs.length - 1][0]) < 0.0005 && Math.abs(latLngs[0][1] - latLngs[latLngs.length - 1][1]) < 0.0005);

        // 4. Start marker (Green flag)
        startMarker = L.marker(latLngs[0], {
          icon: L.divIcon({
            className: '',
            html: '<div class="start-badge"><span>🚩</span><span>Start</span></div>',
            iconSize: [60, 24],
            iconAnchor: isSmallRoute ? [30, 28] : [30, 12]
          }),
          zIndexOffset: 500
        }).addTo(map);

        // 5. End marker (Red flag)
        endMarker = L.marker(latLngs[latLngs.length - 1], {
          icon: L.divIcon({
            className: '',
            html: '<div class="end-badge"><span>🏁</span><span>Finish</span></div>',
            iconSize: [60, 24],
            iconAnchor: isSmallRoute ? [30, -4] : [30, 12]
          }),
          zIndexOffset: 500
        }).addTo(map);

        // 6. Moving pointer marker
        movingMarker = L.marker(latLngs[0], {
          icon: L.divIcon({
            className: 'smooth-moving-marker',
            html: '<div class="moving-marker-wrap"><div id="pulseRing" class="pulse-ring"></div><div id="movingCore" class="moving-core">📍</div></div>',
            iconSize: [44, 44],
            iconAnchor: [22, 22]
          }),
          zIndexOffset: 1000
        }).addTo(map);

        // Frame the route with nice padding
        fitRouteBounds();
        setTimeout(function() {
          map.invalidateSize();
          fitRouteBounds();
        }, 300);

        updatePosition(currentIdx);
      } catch(err) {
        console.error("renderRoute error:", err);
      }
    }

    function zoomToPointer(zoomLevel) {
      isProgrammaticMove = true;
      setAutoFollow(true);
      if (!points || points.length === 0 || !map) {
        isProgrammaticMove = false;
        return;
      }
      var p = points[currentIdx] || points[0];
      if (!p) {
        isProgrammaticMove = false;
        return;
      }
      var lat = Number(p.lat);
      var lng = Number(p.lng);
      if (isNaN(lat) || isNaN(lng)) {
        isProgrammaticMove = false;
        return;
      }
      map.setView([lat, lng], zoomLevel || 20, { animate: true });
      setTimeout(function() { isProgrammaticMove = false; }, 500);
    }

    function setIndex(idx, notify) {
      if (!points || points.length === 0) return;
      currentIdx = Math.max(0, Math.min(idx, points.length - 1));
      updatePosition(currentIdx);

      if (notify && window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'pointChange',
          index: currentIdx,
          point: points[currentIdx]
        }));
      }
    }

    function updatePosition(idx) {
      if (!points || idx >= points.length) return;
      var currentPt = points[idx];
      if (!currentPt) return;
      var lat = Number(currentPt.lat);
      var lng = Number(currentPt.lng);
      if (isNaN(lat) || isNaN(lng)) return;
      var latLng = [lat, lng];

      var ptColor = getSpeedColor(currentPt.speed);

      if (movingMarker) {
        movingMarker.setLatLng(latLng);
        // Dynamically update moving marker pulse and core color to match current speed!
        var ring = document.getElementById('pulseRing');
        var core = document.getElementById('movingCore');
        if (ring) {
          ring.style.background = ptColor + '66';
        }
        if (core) {
          core.style.background = ptColor;
          core.style.boxShadow = '0 4px 12px ' + ptColor + '99';
        }
      }

      if (playedTrail) {
        var covered = points.slice(0, idx + 1)
          .map(function(p) { return [Number(p.lat), Number(p.lng)]; })
          .filter(function(coords) { return !isNaN(coords[0]) && !isNaN(coords[1]); });
        playedTrail.setLatLngs(covered);
      }

      // Auto-follow: if map hasn't been manually moved by user, keep moving marker centered
      if (autoFollow && map) {
        isProgrammaticMove = true;
        map.panTo(latLng, { animate: true, duration: 0.25 });
        setTimeout(function() { isProgrammaticMove = false; }, 300);
      }
    }

    function fitRouteBounds() {
      setAutoFollow(false);
      if (!map) return;
      isProgrammaticMove = true;
      if (trailSegmentsGroup) {
        try {
          var bounds = trailSegmentsGroup.getBounds();
          if (bounds && bounds.isValid()) {
            map.fitBounds(bounds, { padding: [50, 50], maxZoom: 18 });
            setTimeout(function() { isProgrammaticMove = false; }, 500);
            return;
          }
        } catch(e) {}
      }
      if (points && points.length > 0) {
        var p0 = points[0];
        if (p0) {
          var lat = Number(p0.lat);
          var lng = Number(p0.lng);
          if (!isNaN(lat) && !isNaN(lng)) {
            map.setView([lat, lng], 17);
          }
        }
      }
      setTimeout(function() { isProgrammaticMove = false; }, 500);
    }

    window.updateIndex = function(idx) {
      setIndex(idx, false);
    };

    window.setPoints = function(newPoints) {
      try {
        var raw = newPoints;
        if (typeof raw === 'string') {
          try { raw = JSON.parse(raw); } catch(e) {}
        }
        if (typeof raw === 'string') {
          try { raw = JSON.parse(raw); } catch(e) {}
        }
        points = Array.isArray(raw) ? raw : [];
        currentIdx = 0;
        setAutoFollow(true);
        renderRoute();
      } catch(e) {
        console.error("setPoints error:", e);
      }
    };

    window.fitRouteBounds = fitRouteBounds;
    window.zoomToPointer = zoomToPointer;

    // Show/hide the "Jump To" button & sync playback state
    window.setPlaybackActive = function(active, isPlaying) {
      var btn = document.getElementById('gotoBtn');
      if (btn) btn.style.display = active ? 'flex' : 'none';
      if (isPlaying) {
        setAutoFollow(true);
      }
    };

    // Jump to the current playback position & resume auto-following
    function goToCurrent() {
      setAutoFollow(true);
      if (!points || points.length === 0 || !map) return;
      var p = points[currentIdx] || points[0];
      if (!p) return;
      var lat = Number(p.lat);
      var lng = Number(p.lng);
      if (isNaN(lat) || isNaN(lng)) return;
      isProgrammaticMove = true;
      map.panTo([lat, lng], { animate: true, duration: 0.35 });
      setTimeout(function() { isProgrammaticMove = false; }, 400);
    }
    window.goToCurrent = goToCurrent;

    window.setRoadGeometry = function(roadCoords) {
      try {
        if (!map) return;
        if (roadGroup) {
          roadGroup.clearLayers();
        }
        if (!Array.isArray(roadCoords) || roadCoords.length < 2) {
          if (trailSegmentsGroup) {
            trailSegmentsGroup.eachLayer(function(l) {
              if (l.setStyle) l.setStyle({ opacity: 0.95 });
            });
          }
          return;
        }

        // Subtly dim raw GPS segments when snapped road centerline is drawn
        if (trailSegmentsGroup) {
          trailSegmentsGroup.eachLayer(function(l) {
            if (l.setStyle) l.setStyle({ opacity: 0.35 });
          });
        }

        var snappedLatLngs = roadCoords.map(function(c) {
          return [Number(c[0]), Number(c[1])];
        });

        // Ambient dark border for high contrast
        L.polyline(snappedLatLngs, {
          renderer: canvasRenderer,
          color: '#0A0E1A',
          weight: 8,
          opacity: 0.7,
          lineCap: 'round',
          lineJoin: 'round'
        }).addTo(roadGroup);

        // Glowing Neon Cyan Road Line that hugs exact street centerlines
        L.polyline(snappedLatLngs, {
          renderer: canvasRenderer,
          color: '#00E5FF',
          weight: 5.5,
          opacity: 0.95,
          lineCap: 'round',
          lineJoin: 'round'
        }).addTo(roadGroup);
      } catch (err) {
        console.error('setRoadGeometry error:', err);
      }
    };

    window.onload = initMap;
  </script>
</body>
</html>`;
}

export default function OSMHistoryMapView({
  points = [],
  currentIndex = 0,
  isPlaying = false,
  playbackSpeed = 1,
  onPointChange,
  roadCoordinates = [],
  smoothedPoints = [],  // GPS-smoothed trail (replaces OSRM road layer)
  style,
}) {
  const webViewRef = useRef(null);
  const isReady = useRef(false);

  // Static HTML is initialized once
  const staticHtml = useMemo(() => buildStaticHtml(), []);

  const sendPointsToWebView = (pts, idx = 0) => {
    if (!webViewRef.current) return;
    const cleanList = (pts || []).map((p, i) => ({
      index: i,
      lat: Number(p.lat),
      lng: Number(p.lng),
      speed: p.speed != null ? Number(p.speed) : 0,
      recorded_at: p.recorded_at,
    }));
    const serialized = JSON.stringify(cleanList);
    const script = `
      if (window.setPoints) {
        window.setPoints(${serialized});
        window.updateIndex(${idx});
      }
      true;
    `;
    webViewRef.current.injectJavaScript(script);
  };

  // Push trail points to WebView whenever points update.
  // Use smoothedPoints for the visual trail if available, raw points as fallback.
  useEffect(() => {
    const trailPts = smoothedPoints && smoothedPoints.length > 1 ? smoothedPoints : points;
    if (trailPts && trailPts.length > 0) {
      sendPointsToWebView(trailPts, currentIndex);
    }
  }, [points, smoothedPoints]);

  // Update pointer position smoothly via JavaScript injection without reloading HTML
  useEffect(() => {
    if (points && points.length > 0) {
      webViewRef.current?.injectJavaScript(`if (window.updateIndex) { window.updateIndex(${currentIndex}); } true;`);
    }
  }, [currentIndex]);

  // Show/hide the Jump To button based on playback state
  useEffect(() => {
    webViewRef.current?.injectJavaScript(
      `if (window.setPlaybackActive) { window.setPlaybackActive(${points.length > 0}, ${Boolean(isPlaying)}); } true;`
    );
  }, [isPlaying, points]);

  // Push snapped road coordinates to WebView
  useEffect(() => {
    if (isReady.current && webViewRef.current) {
      const script = `
        if (window.setRoadGeometry) {
          window.setRoadGeometry(${JSON.stringify(roadCoordinates || [])});
        }
        true;
      `;
      webViewRef.current.injectJavaScript(script);
    }
  }, [roadCoordinates]);

  const handleMessage = (e) => {
    try {
      const data = JSON.parse(e.nativeEvent.data);
      if (data.type === 'ready') {
        isReady.current = true;
        if (points && points.length > 0) {
          sendPointsToWebView(points, currentIndex);
        }
        if (roadCoordinates && roadCoordinates.length > 0) {
          webViewRef.current?.injectJavaScript(`if (window.setRoadGeometry) { window.setRoadGeometry(${JSON.stringify(roadCoordinates)}); } true;`);
        }
      } else if (data.type === 'pointChange' && onPointChange) {
        onPointChange(data.index, data.point);
      }
    } catch (err) {}
  };

  const handleLoadEnd = () => {
    isReady.current = true;
    if (points && points.length > 0) {
      sendPointsToWebView(points, currentIndex);
    }
    if (roadCoordinates && roadCoordinates.length > 0) {
      webViewRef.current?.injectJavaScript(`if (window.setRoadGeometry) { window.setRoadGeometry(${JSON.stringify(roadCoordinates)}); } true;`);
    }
  };

  return (
    <View style={[styles.container, style]}>
      <WebView
        ref={webViewRef}
        originWhitelist={['*']}
        source={{ html: staticHtml }}
        style={styles.webView}
        onMessage={handleMessage}
        onLoadEnd={handleLoadEnd}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        scrollEnabled={false}
        userAgent="Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 CareTrack/1.0"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0E1A' },
  webView: { flex: 1, backgroundColor: '#0A0E1A' },
});
