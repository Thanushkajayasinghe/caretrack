import React, { useRef, useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

const TILE_URLS = {
  street: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  osm: 'https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png',
  satellite: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
};

const STATIC_HTML = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css" crossorigin="anonymous" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" crossorigin="anonymous" />
  <script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js" crossorigin="anonymous"></script>
  <style>
    * { -webkit-tap-highlight-color: transparent; box-sizing: border-box; }
    html, body, #map { margin: 0; padding: 0; width: 100%; height: 100%; background: #0A0E1A; }
    .leaflet-control-attribution, .leaflet-control-zoom { display: none !important; }
    
    .leaflet-tile-pane, .leaflet-overlay-pane, .leaflet-pane {
      will-change: transform;
    }
    .leaflet-overlay-pane svg, .leaflet-overlay-pane canvas {
      overflow: visible !important;
    }

    .custom-leaflet-icon {
      background: transparent !important;
      border: none !important;
      width: 64px !important;
      height: 64px !important;
      margin-left: -32px !important;
      margin-top: -32px !important;
    }

    .custom-leaflet-parent-icon {
      background: transparent !important;
      border: none !important;
      width: 56px !important;
      height: 56px !important;
      margin-left: -28px !important;
      margin-top: -28px !important;
    }

    .pin-container {
      width: 64px;
      height: 64px;
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    /* Google Maps Directional Flashlight Cone */
    .flashlight-cone-wrap {
      position: absolute;
      top: -33px;
      left: -33px;
      width: 130px;
      height: 130px;
      pointer-events: none;
      transform-origin: 65px 65px;
      transition: transform 0.35s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.5s ease;
      z-index: 3;
    }

    /* Heading direction pointer arrow */
    .heading-arrow {
      position: absolute;
      top: -15px;
      left: 21px;
      width: 22px;
      height: 22px;
      display: flex;
      align-items: center;
      justify-content: center;
      transform-origin: 11px 47px;
      transition: transform 0.4s cubic-bezier(0.4, 0, 0.2, 1);
      z-index: 15;
      pointer-events: none;
    }

    .pin-circle {
      width: 52px;
      height: 52px;
      border-radius: 26px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #ffffff;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-weight: 800;
      font-size: 18px;
      border: 3px solid #38BDF8;
      box-shadow: 0 4px 14px rgba(0,0,0,0.45), 0 0 10px rgba(56, 189, 248, 0.4);
      z-index: 10;
      overflow: hidden;
      background-size: cover;
      background-position: center;
    }

    .pin-avatar-img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      border-radius: 50%;
      display: block;
    }

    .pulse-ring {
      position: absolute;
      top: 6px; left: 6px; width: 52px; height: 52px;
      border-radius: 50%;
      border: 2.5px solid #10B981;
      animation: pulseAnim 1.8s cubic-bezier(0.25, 0, 0.4, 1) infinite;
      pointer-events: none;
      z-index: 5;
    }

    @keyframes pulseAnim {
      0% { transform: scale(0.88); opacity: 1; }
      100% { transform: scale(1.4); opacity: 0; }
    }

    .name-tag {
      position: absolute;
      bottom: -20px;
      background: rgba(15, 23, 42, 0.94);
      color: #FFFFFF;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 12px;
      font-weight: 700;
      padding: 2px 10px;
      border-radius: 12px;
      white-space: nowrap;
      border: 1px solid rgba(255, 255, 255, 0.3);
      box-shadow: 0 2px 6px rgba(0,0,0,0.45);
      z-index: 12;
      letter-spacing: 0.2px;
    }

    .status-tag {
      position: absolute;
      bottom: -44px;
      background: rgba(15, 23, 42, 0.94);
      color: #FFFFFF;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 11px;
      font-weight: 600;
      padding: 2px 10px;
      border-radius: 14px;
      white-space: nowrap;
      border: 1px solid rgba(56, 189, 248, 0.4);
      box-shadow: 0 2px 8px rgba(0,0,0,0.45);
      z-index: 12;
      letter-spacing: 0.1px;
      display: none;
    }

    /* Parent Marker Styles */
    .parent-pin-container {
      width: 56px;
      height: 56px;
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .parent-pin-circle {
      width: 44px;
      height: 44px;
      border-radius: 22px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #ffffff;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-weight: 800;
      font-size: 18px;
      background: linear-gradient(135deg, #0284C7 0%, #0369A1 100%);
      border: 2.5px solid #ffffff;
      box-shadow: 0 4px 14px rgba(2, 132, 199, 0.65);
      z-index: 10;
    }

    .parent-pulse-ring {
      position: absolute;
      top: 6px; left: 6px; width: 44px; height: 44px;
      border-radius: 50%;
      border: 2.5px solid #38BDF8;
      animation: parentPulseAnim 2s cubic-bezier(0.25, 0, 0.4, 1) infinite;
      pointer-events: none;
      z-index: 5;
    }

    @keyframes parentPulseAnim {
      0% { transform: scale(0.85); opacity: 1; }
      100% { transform: scale(1.4); opacity: 0; }
    }

    .parent-name-tag {
      position: absolute;
      bottom: -18px;
      background: rgba(3, 105, 161, 0.95);
      color: #F0F9FF;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 11px;
      font-weight: 700;
      padding: 2px 8px;
      border-radius: 10px;
      white-space: nowrap;
      border: 1px solid rgba(255,255,255,0.45);
      box-shadow: 0 2px 6px rgba(0,0,0,0.5);
      z-index: 12;
      letter-spacing: 0.2px;
    }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    var map, tileLayer, marker, accuracyCircle, trailGroup, canvasRenderer;
    var parentMarker = null, parentAccuracyCircle = null, currentParentLatLng = null;
    var prevLat = null;
    var prevLng = null;
    var prevMovingLat = null;
    var prevMovingLng = null;
    var lastHeading = 0;
    var trailCoords = [];
    var currentMarkerLatLng = null;
    var currentAnimFrame = null;
    var lastHeadingAngle = 0;
    var userInteracting = false;
    var userInteractTimeout = null;

    function getSpeedColor(speedVal) {
      var kmh = (speedVal != null ? Number(speedVal) : 0) * 3.6;
      if (kmh < 7.0) return '#10B981'; // Walk / slow: Emerald Green
      if (kmh < 35.0) return '#F59E0B'; // Cycling / Traffic: Warm Amber
      return '#EF4444'; // Fast / Transit: Vivid Red
    }

    function calculateDistance(lat1, lon1, lat2, lon2) {
      var dLat = (lat2 - lat1) * Math.PI / 180;
      var dLon = (lon2 - lon1) * Math.PI / 180;
      var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
      var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return 6371000 * c;
    }

    function calculateBearing(lat1, lon1, lat2, lon2) {
      var dLon = (lon2 - lon1) * Math.PI / 180;
      var y = Math.sin(dLon) * Math.cos(lat2 * Math.PI / 180);
      var x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
              Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLon);
      var brng = Math.atan2(y, x) * 180 / Math.PI;
      return (brng + 360) % 360;
    }

    function animateMarkerTo(targetLat, targetLng, durationMs) {
      if (!marker) return;
      if (currentAnimFrame) {
        cancelAnimationFrame(currentAnimFrame);
        currentAnimFrame = null;
      }
      if (!currentMarkerLatLng) {
        currentMarkerLatLng = [targetLat, targetLng];
        marker.setLatLng(currentMarkerLatLng);
        if (accuracyCircle) accuracyCircle.setLatLng(currentMarkerLatLng);
        return;
      }

      var startLat = currentMarkerLatLng[0];
      var startLng = currentMarkerLatLng[1];
      var startTime = performance.now();

      function step(now) {
        var elapsed = now - startTime;
        var progress = Math.min(elapsed / durationMs, 1.0);
        // Linear interpolation ensures smooth uniform pacing between 2.5s fixes
        var curLat = startLat + (targetLat - startLat) * progress;
        var curLng = startLng + (targetLng - startLng) * progress;
        currentMarkerLatLng = [curLat, curLng];

        marker.setLatLng(currentMarkerLatLng);
        if (accuracyCircle) accuracyCircle.setLatLng(currentMarkerLatLng);

        if (progress < 1.0) {
          currentAnimFrame = requestAnimationFrame(step);
        } else {
          currentAnimFrame = null;
        }
      }
      currentAnimFrame = requestAnimationFrame(step);
    }

    function postReady() {
      try {
        if (window.ReactNativeWebView && typeof window.ReactNativeWebView.postMessage === 'function') {
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ready' }));
          return true;
        }
      } catch (e) {}
      return false;
    }

    function initMap() {
      if (map) return;
      if (typeof L === 'undefined') {
        setTimeout(initMap, 80);
        return;
      }
      try {
        canvasRenderer = L.canvas({ padding: 0.5 });

        map = L.map('map', {
          center: [6.4157, 80.0008],
          zoom: 17.5,
          maxZoom: 20,
          zoomControl: false,
          attributionControl: false,
          preferCanvas: true,
          renderer: canvasRenderer
        });

        // Track manual user panning/zooming so camera does not fight user interaction
        map.on('movestart dragstart zoomstart', function(e) {
          userInteracting = true;
          if (userInteractTimeout) clearTimeout(userInteractTimeout);
        });

        map.on('moveend dragend zoomend', function(e) {
          if (userInteractTimeout) clearTimeout(userInteractTimeout);
          userInteractTimeout = setTimeout(function() {
            userInteracting = false;
          }, 8000);
        });

        // Official OpenStreetMap Tile Layer (Full street/building coverage up to zoom 20)
        tileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 20,
          maxNativeZoom: 19,
          subdomains: ['a', 'b', 'c'],
          keepBuffer: 12,
          updateWhenIdle: false,
          updateWhenPanning: true,
          updateInterval: 100,
          crossOrigin: true
        }).addTo(map);

        tileLayer.on('tileerror', function(error, tile) {
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

        var iconHtml = '<div class="pin-container">' +
          '<div id="flashlightCone" class="flashlight-cone-wrap" style="transform: rotate(0deg); opacity: 0;">' +
            '<svg width="130" height="130" viewBox="0 0 130 130" fill="none" style="display:block;">' +
              '<defs>' +
                '<radialGradient id="beamGrad" cx="65" cy="65" r="63" gradientUnits="userSpaceOnUse">' +
                  '<stop offset="0%" stop-color="#3B82F6" stop-opacity="0.65"/>' +
                  '<stop offset="38%" stop-color="#60A5FA" stop-opacity="0.32"/>' +
                  '<stop offset="72%" stop-color="#93C5FD" stop-opacity="0.10"/>' +
                  '<stop offset="100%" stop-color="#3B82F6" stop-opacity="0"/>' +
                '</radialGradient>' +
              '</defs>' +
              '<path d="M 65 65 L 32 9 A 63 63 0 0 1 98 9 Z" fill="url(#beamGrad)" />' +
            '</svg>' +
          '</div>' +
          '<div id="headingArrow" class="heading-arrow" style="transform: rotate(0deg); opacity: 1;">' +
            '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" style="display:block; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.6));">' +
              '<path d="M12 2L19 21L12 17L5 21L12 2Z" fill="#2DD4BF" stroke="#FFFFFF" stroke-width="1.8" stroke-linejoin="round"/>' +
            '</svg>' +
          '</div>' +
          '<div class="pulse-ring"></div>' +
          '<div id="pinCircle" class="pin-circle" style="background: #6C63FF;">C</div>' +
          '<div id="nameTag" class="name-tag">Child</div>' +
          '<div id="statusTag" class="status-tag"></div>' +
        '</div>';

        var childIcon = L.divIcon({
          className: 'custom-leaflet-icon',
          html: iconHtml,
          iconSize: [64, 64],
          iconAnchor: [32, 32]
        });

        marker = L.marker([6.4157, 80.0008], { icon: childIcon, opacity: 0, zIndexOffset: 1000 }).addTo(map);

        accuracyCircle = L.circle([6.4157, 80.0008], {
          radius: 25,
          color: 'rgba(129, 140, 248, 0.5)',
          fillColor: '#818CF8',
          fillOpacity: 0.22,
          weight: 1.5
        }).addTo(map);

        // Speed-color-coded trail segments container (uses Canvas renderer so lines never disappear during gestures)
        trailGroup = L.featureGroup().addTo(map);

        if (!postReady()) {
          var readyTries = 0;
          var readyInterval = setInterval(function() {
            readyTries++;
            if (postReady() || readyTries > 60) {
              clearInterval(readyInterval);
            }
          }, 150);
        }
      } catch (err) {
        console.error('initMap error:', err);
        setTimeout(initMap, 250);
      }
    }

    window.updatePosition = function(newLat, newLng, newAccuracy, newHeading, newSpeed, shouldPan) {
      if (!map || newLat == null || newLng == null) return;
      var latLng = [newLat, newLng];
      var isFirst = (prevLat == null || currentMarkerLatLng == null);

      var dist = 0;
      if (prevLat != null && prevLng != null) {
        dist = calculateDistance(prevLat, prevLng, newLat, newLng);
      }

      var isMoving = (newSpeed != null && newSpeed > 0.35);

      if (marker) {
        marker.setOpacity(1);
      }
      if (accuracyCircle) {
        var effectiveRadius = (newAccuracy != null && newAccuracy > 15) ? newAccuracy : 25;
        accuracyCircle.setRadius(effectiveRadius);
        accuracyCircle.setStyle({
          color: 'rgba(129, 140, 248, 0.5)',
          fillColor: '#818CF8',
          fillOpacity: 0.22,
          weight: 1.5
        });
      }

      if (isFirst || dist > 250.0) {
        // Immediate snap for first fix or large teleports
        if (currentAnimFrame) {
          cancelAnimationFrame(currentAnimFrame);
          currentAnimFrame = null;
        }
        currentMarkerLatLng = latLng;
        if (marker) marker.setLatLng(latLng);
        if (accuracyCircle) accuracyCircle.setLatLng(latLng);
      } else if (!isMoving) {
        // INSTANT STOP / ZERO SPEED: Immediately halt any gliding animation and snap cleanly to exact anchor
        if (currentAnimFrame) {
          cancelAnimationFrame(currentAnimFrame);
          currentAnimFrame = null;
        }
        currentMarkerLatLng = latLng;
        if (marker) marker.setLatLng(latLng);
        if (accuracyCircle) accuracyCircle.setLatLng(latLng);
      } else {
        // ACTIVELY MOVING: Glide smoothly over 2400ms (matching the 2.5s update cadence)
        animateMarkerTo(newLat, newLng, 2400);
      }

      var effectiveHeading = (newHeading != null && !isNaN(Number(newHeading))) ? Number(newHeading) : null;
      if (effectiveHeading == null && prevLat != null && prevLng != null && dist > 1.2 && dist < 180.0) {
        effectiveHeading = calculateBearing(prevLat, prevLng, newLat, newLng);
      }

      var arrow = document.getElementById('headingArrow');
      var cone = document.getElementById('flashlightCone');
      if (effectiveHeading != null) {
        var diff = (effectiveHeading - (lastHeadingAngle % 360) + 540) % 360 - 180;
        lastHeadingAngle += diff;
        if (arrow) {
          arrow.style.opacity = '1';
          arrow.style.transform = 'rotate(' + lastHeadingAngle + 'deg)';
        }
        if (cone) {
          cone.style.opacity = isMoving ? '1' : '0.85';
          cone.style.transform = 'rotate(' + lastHeadingAngle + 'deg)';
        }
      } else {
        // Dim arrow and hide flashlight cone if no heading data exists
        if (arrow) arrow.style.opacity = '0.35';
        if (cone) cone.style.opacity = '0';
      }

      var isAccurate = (newAccuracy == null || Number(newAccuracy) <= 120.0);
      var isMoving = (newSpeed != null && Number(newSpeed) >= 0.45 && isAccurate);

      var maxLiveGap = 350.0;
      if (prevMovingLat != null && prevMovingLng != null && isMoving && trailGroup) {
        var movingDist = calculateDistance(prevMovingLat, prevMovingLng, newLat, newLng);
        if (movingDist >= 2.5 && movingDist <= maxLiveGap) {
          var segColor = getSpeedColor(newSpeed);
          L.polyline([[prevMovingLat, prevMovingLng], latLng], {
            renderer: canvasRenderer,
            color: segColor,
            weight: 4.5,
            opacity: 0.85,
            lineCap: 'round',
            lineJoin: 'round'
          }).addTo(trailGroup);

          // Retain up to 1000 live segments in memory for long continuous trails
          var layers = trailGroup.getLayers();
          if (layers.length > 1000) {
            trailGroup.removeLayer(layers[0]);
          }
        }
      }

      if (isMoving) {
        prevMovingLat = newLat;
        prevMovingLng = newLng;
      } else {
        prevMovingLat = null;
        prevMovingLng = null;
      }

      prevLat = newLat;
      prevLng = newLng;

      if (isFirst) {
        map.setView(latLng, 16);
      } else if (!userInteracting) {
        // Only smoothly follow child when parent is not actively dragging or exploring elsewhere
        map.panTo(latLng, { animate: true, duration: 0.6 });
      }
    };

    window.updateChild = function(name, color, initial, avatarUrl) {
      try {
        var pinCircle = document.getElementById('pinCircle');
        if (pinCircle) {
          pinCircle.style.width = '52px';
          pinCircle.style.height = '52px';
          pinCircle.style.borderRadius = '26px';
          pinCircle.style.fontSize = '18px';
          pinCircle.style.border = '3px solid #38BDF8';
          pinCircle.innerHTML = '';
          if (avatarUrl && avatarUrl !== 'null' && avatarUrl !== 'undefined' && String(avatarUrl).trim().length > 10) {
            pinCircle.style.background = '#0F172A';
            var img = document.createElement('img');
            img.className = 'pin-avatar-img';
            img.alt = '';
            img.onerror = function() {
              this.style.display = 'none';
              pinCircle.textContent = initial || 'C';
              if (color) pinCircle.style.background = color;
            };
            img.src = avatarUrl;
            pinCircle.appendChild(img);
          } else {
            pinCircle.textContent = initial || 'C';
            if (color) pinCircle.style.background = color;
          }
        }
        var nameTag = document.getElementById('nameTag');
        if (nameTag && name) {
          nameTag.textContent = name;
          nameTag.style.fontSize = '12px';
          nameTag.style.fontWeight = '700';
          nameTag.style.padding = '2px 10px';
          nameTag.style.borderRadius = '12px';
          nameTag.style.bottom = '-20px';
        }
        if (accuracyCircle) {
          accuracyCircle.setStyle({ color: 'rgba(129, 140, 248, 0.5)', fillColor: '#818CF8', fillOpacity: 0.22 });
        }
      } catch (err) {
        console.error('updateChild error:', err);
      }
    };

    window.updateStatusTag = function(text, isVisible) {
      var statusTag = document.getElementById('statusTag');
      if (statusTag) {
        if (isVisible && text) {
          statusTag.textContent = text;
          statusTag.style.fontSize = '11px';
          statusTag.style.fontWeight = '600';
          statusTag.style.padding = '2px 10px';
          statusTag.style.borderRadius = '14px';
          statusTag.style.bottom = '-44px';
          statusTag.style.display = 'block';
        } else {
          statusTag.style.display = 'none';
        }
      }
    };

    window.setTrail = function(coords) {
      if (trailGroup) {
        trailGroup.clearLayers();
      }
      prevMovingLat = null;
      prevMovingLng = null;

      if (!Array.isArray(coords) || coords.length < 2) {
        return;
      }
      var filtered = [];
      for (var i = 0; i < coords.length; i++) {
        var pt = coords[i];
        if (!pt || pt[0] == null || pt[1] == null) continue;
        if (filtered.length > 0) {
          var last = filtered[filtered.length - 1];
          var d = calculateDistance(last[0], last[1], pt[0], pt[1]);
          if (d < 0.5) {
            continue;
          }
        }
        filtered.push(pt);
      }

      for (var j = 0; j < filtered.length - 1; j++) {
        var pA = [filtered[j][0], filtered[j][1]];
        var pB = [filtered[j + 1][0], filtered[j + 1][1]];
        var distAB = calculateDistance(pA[0], pA[1], pB[0], pB[1]);
        var segSpeed = filtered[j + 1][2] != null ? Number(filtered[j + 1][2]) : 0;
        var maxGap = 500.0;
        if (distAB > maxGap || distAB < 0.5) {
          // Large gap or jump between disconnected trips/locations: never connect with straight line across towns
          continue;
        }
        var segColor = segSpeed > 0 ? getSpeedColor(segSpeed) : '#00E5FF';
        L.polyline([pA, pB], {
          renderer: canvasRenderer,
          color: segColor,
          weight: 4.5,
          opacity: 0.85,
          lineCap: 'round',
          lineJoin: 'round'
        }).addTo(trailGroup);
      }
    };

    window.setTile = function(newUrl) {
      if (tileLayer && map && newUrl) {
        map.removeLayer(tileLayer);
        var sub = newUrl.includes('{s}') ? ['a', 'b', 'c'] : undefined;
        var isSatellite = newUrl.includes('World_Imagery');
        var opts = {
          maxZoom: 20,
          maxNativeZoom: isSatellite ? 18 : 19,
          keepBuffer: 12,
          updateWhenIdle: false,
          updateWhenPanning: true,
          updateInterval: 100,
          crossOrigin: true
        };
        if (sub) opts.subdomains = sub;
        tileLayer = L.tileLayer(newUrl, opts).addTo(map);
      }
    };

    window.updateParentPosition = function(pLat, pLng, pAccuracy, shouldPan) {
      if (!map || pLat == null || pLng == null) return;
      var latLng = [pLat, pLng];

      if (!parentMarker) {
        var parentIconHtml = '<div class="parent-pin-container">' +
          '<div class="parent-pulse-ring"></div>' +
          '<div class="parent-pin-circle">👤</div>' +
          '<div class="parent-name-tag">You</div>' +
        '</div>';

        var parentIcon = L.divIcon({
          className: 'custom-leaflet-parent-icon',
          html: parentIconHtml,
          iconSize: [56, 56],
          iconAnchor: [28, 28]
        });

        parentMarker = L.marker(latLng, { icon: parentIcon, zIndexOffset: 900 }).addTo(map);

        parentAccuracyCircle = L.circle(latLng, {
          radius: pAccuracy || 15,
          color: '#0284C7',
          fillColor: '#38BDF8',
          fillOpacity: 0.15,
          weight: 1.5
        }).addTo(map);
      } else {
        parentMarker.setLatLng(latLng);
        if (parentAccuracyCircle) {
          parentAccuracyCircle.setLatLng(latLng);
          if (pAccuracy != null) parentAccuracyCircle.setRadius(pAccuracy);
        }
      }

      currentParentLatLng = latLng;

      if (shouldPan) {
        map.panTo(latLng, { animate: true, duration: 0.6 });
      }
    };

    window.removeParentPosition = function() {
      if (parentMarker) {
        map.removeLayer(parentMarker);
        parentMarker = null;
      }
      if (parentAccuracyCircle) {
        map.removeLayer(parentAccuracyCircle);
        parentAccuracyCircle = null;
      }
      currentParentLatLng = null;
    };

    window.fitBoth = function() {
      if (!map) return;
      var targets = [];
      if (currentMarkerLatLng) targets.push(currentMarkerLatLng);
      if (currentParentLatLng) targets.push(currentParentLatLng);
      if (targets.length === 2) {
        var bounds = L.latLngBounds(targets);
        map.fitBounds(bounds, { padding: [80, 80], maxZoom: 18 });
      } else if (targets.length === 1) {
        map.setView(targets[0], 17.5, { animate: true });
      }
    };

    window.recenterParent = function(zoom) {
      if (!map || !currentParentLatLng) return;
      var targetZoom = zoom || map.getZoom() || 17.5;
      if (targetZoom < 17.5) targetZoom = 17.5;
      map.setView(currentParentLatLng, targetZoom, { animate: true });
    };

    window.recenter = function(cLat, cLng, zoom) {
      userInteracting = false;
      if (userInteractTimeout) clearTimeout(userInteractTimeout);
      if (map && cLat != null && cLng != null) {
        var targetZoom = zoom || map.getZoom() || 17.5;
        if (targetZoom < 17.5) targetZoom = 17.5;
        map.setView([cLat, cLng], targetZoom, { animate: true });
      }
    };

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      initMap();
    } else {
      window.addEventListener('DOMContentLoaded', initMap);
      window.addEventListener('load', initMap);
    }
    setTimeout(initMap, 400);
  </script>
</body>
</html>
`;

const OSMMapView = React.forwardRef(function OSMMapView({
  child,
  location,
  parentLocation = null,
  onParentLocation = null,
  recentTrail = [],
  mapStyle = 'street',
  statusMessage = '',
  onMapReady,
  style,
}, ref) {
  const webViewRef = useRef(null);
  const isMapReady = useRef(false);

  React.useImperativeHandle(ref, () => ({
    recenter: (lat, lng, zoom) => {
      if (isMapReady.current && lat != null && lng != null) {
        const zoomParam = zoom != null ? `, ${zoom}` : '';
        webViewRef.current?.injectJavaScript(`window.recenter(${lat}, ${lng}${zoomParam}); true;`);
      }
    },
    fitBoth: () => {
      if (isMapReady.current) {
        webViewRef.current?.injectJavaScript('window.fitBoth(); true;');
      }
    },
    recenterParent: (zoom) => {
      if (isMapReady.current) {
        const zoomParam = zoom != null ? `${zoom}` : '';
        webViewRef.current?.injectJavaScript(`window.recenterParent(${zoomParam}); true;`);
      }
    },
    updateStatusTag: (msg) => {
      if (isMapReady.current) {
        const safeMsg = JSON.stringify(msg || '');
        const isVisible = Boolean(msg);
        webViewRef.current?.injectJavaScript(`window.updateStatusTag(${safeMsg}, ${isVisible}); true;`);
      }
    },
    updateChild: (childObj) => {
      if (isMapReady.current && childObj) {
        const sName = JSON.stringify(childObj.name || 'Child');
        const sColor = JSON.stringify(childObj.avatar_color || '#6C63FF');
        const sInitial = JSON.stringify(childObj.name?.[0]?.toUpperCase() || 'C');
        const sAvatar = JSON.stringify(childObj.avatar_url || null);
        webViewRef.current?.injectJavaScript(`window.updateChild(${sName}, ${sColor}, ${sInitial}, ${sAvatar}); true;`);
      }
    },
  }));

  // Memoize static source and re-evaluate when STATIC_HTML changes
  const htmlSource = useMemo(() => ({
    html: STATIC_HTML,
    baseUrl: 'https://caretrack.app',
  }), [STATIC_HTML]);

  const childName = child?.name || 'Child';
  const avatarColor = child?.avatar_color || '#6C63FF';
  const initial = childName[0] ? childName[0].toUpperCase() : 'C';

  // Push updates when location changes
  useEffect(() => {
    if (isMapReady.current && location?.lat && location?.lng) {
      const headingVal = location.heading != null ? location.heading : 'null';
      const speedVal = (location.speed != null && !isNaN(location.speed)) ? Number(location.speed) : 0;
      const js = `window.updatePosition(${location.lat}, ${location.lng}, ${location.accuracy || 0}, ${headingVal}, ${speedVal}); true;`;
      webViewRef.current?.injectJavaScript(js);
    }
  }, [location?.lat, location?.lng, location?.accuracy, location?.heading, location?.speed]);

  // Push updates when child info changes
  useEffect(() => {
    if (isMapReady.current) {
      const safeName = JSON.stringify(childName);
      const safeColor = JSON.stringify(avatarColor);
      const safeInitial = JSON.stringify(initial);
      const safeAvatar = JSON.stringify(child?.avatar_url || null);
      const js = `window.updateChild(${safeName}, ${safeColor}, ${safeInitial}, ${safeAvatar}); true;`;
      webViewRef.current?.injectJavaScript(js);
    }
  }, [childName, avatarColor, initial, child?.avatar_url]);

  // Push updates when recentTrail changes
  useEffect(() => {
    if (isMapReady.current) {
      const coords = (recentTrail && recentTrail.length > 0)
        ? recentTrail.map((p) => [p.latitude || p.lat, p.longitude || p.lng, p.speed || 0])
        : [];
      const js = `window.setTrail(${JSON.stringify(coords)}); true;`;
      webViewRef.current?.injectJavaScript(js);
    }
  }, [recentTrail]);

  // Push updates when statusMessage changes
  useEffect(() => {
    if (isMapReady.current) {
      const safeMsg = JSON.stringify(statusMessage || '');
      const isVisible = Boolean(statusMessage);
      const js = `window.updateStatusTag(${safeMsg}, ${isVisible}); true;`;
      webViewRef.current?.injectJavaScript(js);
    }
  }, [statusMessage]);

  // Push tile style when mapStyle changes
  useEffect(() => {
    if (isMapReady.current && TILE_URLS[mapStyle]) {
      const js = `window.setTile('${TILE_URLS[mapStyle]}'); true;`;
      webViewRef.current?.injectJavaScript(js);
    }
  }, [mapStyle]);

  // Push updates when parentLocation changes
  useEffect(() => {
    if (isMapReady.current) {
      if (parentLocation?.lat != null && parentLocation?.lng != null) {
        const js = `window.updateParentPosition(${parentLocation.lat}, ${parentLocation.lng}, ${parentLocation.accuracy || 0}); true;`;
        webViewRef.current?.injectJavaScript(js);
      } else {
        webViewRef.current?.injectJavaScript('window.removeParentPosition(); true;');
      }
    }
  }, [parentLocation?.lat, parentLocation?.lng, parentLocation?.accuracy]);

  const handleMessage = (event) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'ready') {
        isMapReady.current = true;
        // Sync initial state to Leaflet
        const safeName = JSON.stringify(childName);
        const safeColor = JSON.stringify(avatarColor);
        const safeInitial = JSON.stringify(initial);
        const safeAvatar = JSON.stringify(child?.avatar_url || null);
        let js = `window.updateChild(${safeName}, ${safeColor}, ${safeInitial}, ${safeAvatar});`;
        if (TILE_URLS[mapStyle]) {
          js += `window.setTile('${TILE_URLS[mapStyle]}');`;
        }
        if (recentTrail && recentTrail.length > 0) {
          const coords = recentTrail.map((p) => [p.latitude || p.lat, p.longitude || p.lng, p.speed || 0]);
          js += `window.setTrail(${JSON.stringify(coords)});`;
        } else {
          js += `window.setTrail([]);`;
        }
        if (location?.lat && location?.lng) {
          const headingVal = location.heading != null ? location.heading : 'null';
          const speedVal = location.speed != null ? location.speed : '0';
          js += `window.updatePosition(${location.lat}, ${location.lng}, ${location.accuracy || 0}, ${headingVal}, ${speedVal}, true);`;
        }
        if (parentLocation?.lat != null && parentLocation?.lng != null) {
          js += `window.updateParentPosition(${parentLocation.lat}, ${parentLocation.lng}, ${parentLocation.accuracy || 0});`;
        }
        js += ' true;';
        webViewRef.current?.injectJavaScript(js);

        if (onMapReady) onMapReady();
      }
    } catch (e) { }
  };

  return (
    <View style={[styles.container, style]}>
      <WebView
        key="osm_map_v4_compact"
        ref={webViewRef}
        originWhitelist={['*']}
        source={htmlSource}
        style={styles.webView}
        onMessage={handleMessage}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        geolocationEnabled={true}
        mixedContentMode="always"
        allowFileAccess={true}
        allowUniversalAccessFromFileURLs={true}
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        overScrollMode="never"
        scrollEnabled={false}
        androidHardwareAccelerationDisabled={false}
        cacheEnabled={true}
        userAgent="Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 CareTrack/1.0"
      />
    </View>
  );
});

export default OSMMapView;

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
  },
  webView: {
    flex: 1,
    width: '100%',
    height: '100%',
    backgroundColor: '#0A0E1A',
  },
});
