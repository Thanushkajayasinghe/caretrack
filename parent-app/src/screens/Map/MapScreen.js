import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Animated, Dimensions, Alert, Image, Platform, StatusBar,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons as Icon } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { format, isToday } from 'date-fns';
import { Colors, Fonts, Spacing, Radius } from '../../theme/tokens';
import { childAPI, locationAPI } from '../../services/api';
import {
  onLocationUpdate, offLocationUpdate,
  onChildStatus, offChildStatus,
  onChildBatteryLow, offChildBatteryLow,
  isSocketConnected
} from '../../services/socket';
import OSMMapView from '../../components/OSMMapView';
import { activateKeepAwake, deactivateKeepAwake } from '../../utils/keepAwake';
import {
  startWatchingParentLocation,
  stopWatchingParentLocation,
  checkLocationPermission,
  requestLocationPermission,
} from '../../services/parentLocation';
import { snapPointsToRoads } from '../../services/roadSnapping';
import SnapshotModal from '../../components/SnapshotModal';

const { width, height } = Dimensions.get('window');

// High-speed open-source raster tile providers with global CDN
const TILE_LAYERS = {
  street: {
    id: 'street',
    name: 'Street',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    icon: 'map-outline',
  },
  osm: {
    id: 'osm',
    name: 'OSM',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    icon: 'earth-outline',
  },
  satellite: {
    id: 'satellite',
    name: 'Satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    icon: 'planet-outline',
  },
};

const MAP_LAYER_OPTIONS = [
  {
    id: 'street',
    label: 'Street',
    image: require('../../assets/map_layers/map_street.png'),
  },
  {
    id: 'satellite',
    label: 'Satellite',
    image: require('../../assets/map_layers/map_satellite.png'),
  },
  {
    id: 'osm',
    label: 'OSM',
    image: require('../../assets/map_layers/map_osm.png'),
  },
];

export default function MapScreen({ route }) {
  const initialChildId = route?.params?.childId;
  const mapRef = useRef(null);
  const lastLocationRef = useRef({});
  const [parentLocation, setParentLocation] = useState(null); // parent's own GPS
  const [showParentLocation, setShowParentLocation] = useState(false); // toggle parent location on/off

  // Live GPS watcher for parent's location when toggled on
  useEffect(() => {
    let stopWatcher = null;
    if (showParentLocation) {
      startWatchingParentLocation(
        (loc) => {
          setParentLocation(loc);
        },
        (err) => {
          console.warn('Parent location error:', err);
          Alert.alert(
            'Location Error',
            'Unable to get current location. Please verify that GPS/Location is enabled.'
          );
          setShowParentLocation(false);
        }
      ).then((cleanup) => {
        stopWatcher = cleanup;
      });
    } else {
      stopWatchingParentLocation();
      setParentLocation(null);
    }

    return () => {
      if (stopWatcher) stopWatcher();
      stopWatchingParentLocation();
    };
  }, [showParentLocation]);

  const toggleParentLocation = async () => {
    if (showParentLocation) {
      setShowParentLocation(false);
      setParentLocation(null);
    } else {
      const hasPerm = await checkLocationPermission();
      if (!hasPerm) {
        const granted = await requestLocationPermission();
        if (!granted) {
          Alert.alert(
            'Location Permission Required',
            'Please allow location permission to display your position relative to your child on the live map.'
          );
          return;
        }
      }
      setShowParentLocation(true);
    }
  };

  const [children, setChildren] = useState([]);
  const [selectedChildId, setSelectedChildId] = useState(initialChildId || null);
  const [liveLocations, setLiveLocations] = useState({}); // childId → { lat, lng, accuracy, speed, heading, batteryLevel, isCharging }
  const [recentTrail, setRecentTrail] = useState([]); // positions for current child
  const [showTrail, setShowTrail] = useState(true); // toggle trail line on/off
  const [stationarySince, setStationarySince] = useState(null); // timestamp since child stayed in current cluster
  const [nowTime, setNowTime] = useState(Date.now()); // periodically updated for live minute ticker
  const [lowBatteryAlert, setLowBatteryAlert] = useState(null); // { childId, batteryLevel, childName }
  const [mapReady, setMapReady] = useState(false);
  const [currentLayer, setCurrentLayer] = useState('street');
  const [snapshotModalVisible, setSnapshotModalVisible] = useState(false);
  const fadeAnim = useRef(new Animated.Value(1)).current;

  // Fallback reveal in case initial map takes an extra moment on first launch
  useEffect(() => {
    const timer = setTimeout(() => {
      Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }).start();
    }, 1200);
    return () => clearTimeout(timer);
  }, []);

  // Listen for critical low-battery alerts from child devices
  useEffect(() => {
    const handleLowBattery = (data) => {
      const matched = children.find((c) => c.id === data.childId);
      setLowBatteryAlert({
        childId: data.childId,
        batteryLevel: data.batteryLevel,
        childName: matched?.name || 'Child',
      });
    };
    onChildBatteryLow(handleLowBattery);
    return () => offChildBatteryLow(handleLowBattery);
  }, [children]);

  // Auto-tick every 30s so "Staying in same place for X minutes" updates live
  useEffect(() => {
    const timer = setInterval(() => setNowTime(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  // Helper to compute distance in meters between two lat/lng pairs
  const getDistanceMeters = (lat1, lon1, lat2, lon2) => {
    if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return 0;
    const R = 6371e3;
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;
    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
  };

  useFocusEffect(useCallback(() => {
    loadChildren();
    activateKeepAwake();
    return () => {
      deactivateKeepAwake();
    };
  }, []));

  useEffect(() => {
    if (initialChildId) setSelectedChildId(initialChildId);
  }, [initialChildId]);

  // Load recent positions (last 24 hours) when selected child changes
  useEffect(() => {
    if (!selectedChildId) return;
    const fetchTrail = async () => {
      try {
        const fromDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const { data } = await locationAPI.history({
          childId: selectedChildId,
          from: fromDate.toISOString(),
          to: new Date().toISOString(),
          limit: 1500,
          order: 'desc',
        });
        if (data.points?.length > 0) {
          // Keep points with reasonable accuracy (<= 120m)
          const valid = data.points.filter((p) => !p.accuracy || p.accuracy <= 120);

          // Calculate stationary duration: start from latest point and walk backwards
          if (valid.length > 0) {
            const latest = valid[valid.length - 1];
            let earliestStationary = new Date(latest.recorded_at);
            for (let i = valid.length - 2; i >= 0; i--) {
              const p = valid[i];
              const d = getDistanceMeters(latest.lat, latest.lng, p.lat, p.lng);
              if (d <= 35.0) {
                earliestStationary = new Date(p.recorded_at);
              } else {
                break;
              }
            }
            const speedKmh = (latest.speed != null ? Number(latest.speed) : 0) * 3.6;
            if (speedKmh < 1.2) {
              setStationarySince(earliestStationary);
            } else {
              setStationarySince(null);
            }
          }

          // Extract contiguous points belonging to the recent journey
          const currentTripPoints = [];
          for (let i = valid.length - 1; i >= 0; i--) {
            const p = valid[i];
            const pAcc = p.accuracy != null ? Number(p.accuracy) : 999;
            const pSpeedKmh = (p.speed != null ? Number(p.speed) : 0) * 3.6;
            const isPointStill = p.activityType === 'still' || pSpeedKmh < 0.5;

            // Stop traversing backwards if we encounter a gap > 15 minutes or jump > 500m (previous trip)
            if (currentTripPoints.length > 0) {
              const prev = currentTripPoints[currentTripPoints.length - 1];
              const dist = getDistanceMeters(p.lat, p.lng, prev.lat, prev.lng);
              const timeDiff = Math.abs(new Date(prev.recorded_at) - new Date(p.recorded_at));
              if (dist > 500.0 || timeDiff > 15 * 60 * 1000) {
                break;
              }
            }

            // Include raw movement fixes in trail
            if (!isPointStill && pAcc <= 120.0) {
              currentTripPoints.push(p);
            }
            if (currentTripPoints.length >= 1000) break;
          }
          currentTripPoints.reverse();

          // Deduplicate points within 2 meters of previous to keep long path clean
          const filtered = [];
          for (let i = 0; i < currentTripPoints.length; i++) {
            const p = currentTripPoints[i];
            if (filtered.length > 0) {
              const last = filtered[filtered.length - 1];
              const d = getDistanceMeters(last.lat, last.lng, p.lat, p.lng);
              if (d < 2.0) continue;
            }
            filtered.push(p);
          }

          // Render the trail only if we have at least 2 genuine moving points
          if (filtered.length >= 2) {
            // First show raw points immediately for instant feedback
            setRecentTrail(filtered.map((p) => ({ latitude: p.lat, longitude: p.lng, speed: p.speed })));

            // Asynchronously enhance trail with OSRM road snapping
            snapPointsToRoads(filtered).then((snapped) => {
              if (snapped && snapped.length >= 2) {
                // Smooth speeds over a 5-point rolling window to suppress GPS jitter spikes.
                // A single noisy fix can report e.g. 108 km/h while walking — smoothing kills it.
                const SMOOTH_WIN = 5;
                const half = Math.floor(SMOOTH_WIN / 2);
                const smoothed = filtered.map((p, i) => {
                  const lo = Math.max(0, i - half);
                  const hi = Math.min(filtered.length - 1, i + half);
                  let sum = 0;
                  for (let k = lo; k <= hi; k++) sum += filtered[k].speed ?? 0;
                  return { ...p, speed: sum / (hi - lo + 1) };
                });

                // Interpolate smoothed speed from nearest original GPS point for each snapped coord.
                setRecentTrail(snapped.map((coord) => {
                  let nearestSpeed = 0;
                  let minDist = Infinity;
                  for (let i = 0; i < smoothed.length; i++) {
                    const d = getDistanceMeters(smoothed[i].lat, smoothed[i].lng, coord[0], coord[1]);
                    if (d < minDist) {
                      minDist = d;
                      nearestSpeed = smoothed[i].speed;
                    }
                  }
                  return { latitude: coord[0], longitude: coord[1], speed: nearestSpeed };
                }));
              }
            }).catch(() => {});
          } else {
            setRecentTrail([]);
          }
        } else {
          setRecentTrail([]);
          if (selectedLoc?.recordedAt) {
            setStationarySince(new Date(selectedLoc.recordedAt));
          }
        }
      } catch (e) {
        setRecentTrail([]);
      }
    };
    fetchTrail();
  }, [selectedChildId]);

  const processLocationUpdate = useCallback((data) => {
    if (!data || data.lat == null || data.lng == null) return;
    // Accept points up to 150m so indoor Wi-Fi/home locations and cell towers are displayed properly
    if (data.accuracy && data.accuracy > 150) return;

    const rawSpeedKmh = (data.speed != null ? Number(data.speed) : 0) * 3.6;
    const prevLoc = lastLocationRef.current[data.childId];
    const distFromPrev = (prevLoc?.lat != null && prevLoc?.lng != null)
      ? getDistanceMeters(prevLoc.lat, prevLoc.lng, data.lat, data.lng)
      : null;

    // Filter impossible GPS speed spikes (> 140 km/h) or teleport glitches:
    const isGlitchSpeed = rawSpeedKmh > 140.0 || (distFromPrev != null && distFromPrev > 350.0 && rawSpeedKmh > 90.0);
    const isExplicitlyStill = data.activityType === 'still';
    const speedKmh = (isGlitchSpeed || isExplicitlyStill) ? 0 : rawSpeedKmh;
    const effectiveSpeed = speedKmh / 3.6;
    const isActivityMoving = !isExplicitlyStill && data.activityType && ['walking', 'running', 'in_vehicle', 'on_bicycle'].includes(data.activityType);
    const isMoving = !isExplicitlyStill && (speedKmh >= 1.2 || isActivityMoving);

    if (data.childId === selectedChildId) {
      if (isMoving) {
        setStationarySince(null);
      } else {
        setStationarySince((prev) => {
          if (!prev) return new Date(data.recordedAt || Date.now());
          if (distFromPrev != null && distFromPrev >= 25.0) {
            return new Date(data.recordedAt || Date.now());
          }
          return prev;
        });
      }
    }

    lastLocationRef.current[data.childId] = {
      lat: data.lat,
      lng: data.lng,
      speed: effectiveSpeed,
      recordedAt: data.recordedAt,
    };

    setLiveLocations((prev) => {
      const existing = prev[data.childId];
      // Infer activity accurately based on physical speed
      let inferredActivity = 'still';
      if (speedKmh >= 18.0) inferredActivity = 'in_vehicle';
      else if (speedKmh >= 7.5) inferredActivity = 'on_bicycle';
      else if (speedKmh >= 1.5) inferredActivity = 'walking';

      let rawActivity = data.activityType ?? (speedKmh < 0.5 ? 'still' : (existing?.activityType ?? inferredActivity));
      // Ironclad transit memory: if currently in vehicle, never drop into walking or running
      // while slowing down or waiting briefly at red lights / junctions.
      if (existing?.activityType === 'in_vehicle' && !isExplicitlyStill) {
        if (!data.activityType || data.activityType === 'walking' || data.activityType === 'running' || speedKmh >= 0.5) {
          rawActivity = 'in_vehicle';
        }
      }
      if (rawActivity === 'running' && speedKmh < 7.0 && rawActivity !== 'in_vehicle') {
        rawActivity = 'walking';
      }
      const resolvedActivity = isExplicitlyStill ? 'still' : rawActivity;

      return {
        ...prev,
        [data.childId]: {
          ...existing,
          lat: data.lat ?? existing?.lat,
          lng: data.lng ?? existing?.lng,
          accuracy: data.accuracy ?? existing?.accuracy,
          speed: isExplicitlyStill ? 0 : effectiveSpeed,
          heading: data.heading ?? existing?.heading,
          batteryLevel: (data.batteryLevel !== undefined && data.batteryLevel !== null)
            ? data.batteryLevel
            : existing?.batteryLevel,
          isCharging: (data.isCharging !== undefined && data.isCharging !== null)
            ? data.isCharging
            : existing?.isCharging,
          activityType: resolvedActivity,
          recordedAt: data.recordedAt ?? existing?.recordedAt,
        },
      };
    });

    // Append to trail when moving (never clear on stationary so trip remains visible)
    const isMovingPoint = !isExplicitlyStill && speedKmh >= 0.5 && (data.accuracy == null || Number(data.accuracy) <= 150);

    if (isMovingPoint && data.childId === selectedChildId && data.lat && data.lng) {
      setRecentTrail((prev) => {
        if (prev.length === 0) {
          return [{ latitude: data.lat, longitude: data.lng, speed: data.speed }];
        }
        const last = prev[prev.length - 1];
        const dist = getDistanceMeters(last.latitude, last.longitude, data.lat, data.lng);
        if (dist < 2.0) {
          return prev;
        }
        if (dist > 400.0) {
          // Large teleport or disconnected trip: start fresh segment
          return [{ latitude: data.lat, longitude: data.lng, speed: data.speed }];
        }
        const next = [...prev, { latitude: data.lat, longitude: data.lng, speed: data.speed }];
        return next.slice(-1000);
      });
    }

    // Recenter camera if necessary
    if (mapRef.current?.recenter && data.lat && data.lng) {
      // Handled directly by Leaflet updatePosition
    }
  }, [selectedChildId, mapReady]);

  // Real-time socket event listeners
  useEffect(() => {
    const handler = (data) => {
      processLocationUpdate(data);
    };

    const statusHandler = (data) => {
      setLiveLocations((prev) => {
        const existing = prev[data.childId];
        return {
          ...prev,
          [data.childId]: {
            ...existing,
            batteryLevel: (data.batteryLevel !== undefined && data.batteryLevel !== null)
              ? data.batteryLevel
              : existing?.batteryLevel,
            isCharging: data.isCharging ?? existing?.isCharging,
            speed: (data.speed !== undefined && data.speed !== null)
              ? Number(data.speed)
              : existing?.speed,
            activityType: data.activityType ?? existing?.activityType,
            heading: (data.heading !== undefined && data.heading !== null)
              ? Number(data.heading)
              : existing?.heading,
            recordedAt: existing?.recordedAt || data.lastSeen || new Date().toISOString(),
          },
        };
      });
    };

    onLocationUpdate(handler);
    onChildStatus(statusHandler);
    return () => {
      offLocationUpdate(handler);
      offChildStatus(statusHandler);
    };
  }, [processLocationUpdate]);

  // Live active HTTP polling fallback (every 3.5s) so map updates reliably regardless of socket connectivity
  useEffect(() => {
    if (!selectedChildId) return;
    let isMounted = true;

    const pollLive = async () => {
      // If real-time WebSocket is actively connected, skip HTTP polling to conserve battery and CPU
      if (isSocketConnected()) return;

      try {
        const { data } = await locationAPI.live(selectedChildId);
        if (!isMounted) return;
        const loc = data?.location;
        const dev = data?.device;
        if (!loc && !dev) return;

        processLocationUpdate({
          childId: selectedChildId,
          lat: loc?.lat,
          lng: loc?.lng,
          accuracy: loc?.accuracy,
          speed: loc?.speed,
          heading: loc?.heading,
          batteryLevel: dev?.battery_level ?? loc?.battery_level,
          isCharging: dev?.is_charging ?? loc?.is_charging,
          recordedAt: loc?.recorded_at || dev?.last_seen,
          activityType: loc?.activityType,
        });
      } catch (_e) {}
    };

    const interval = setInterval(pollLive, 3500);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [selectedChildId, processLocationUpdate]);

  const loadChildren = async () => {
    try {
      const { data } = await childAPI.list();
      setChildren(data.children || []);

      const locs = {};
      for (const child of data.children) {
        if (child.lastLocation) {
          const locAge = child.lastLocation.recorded_at
            ? Math.abs(Date.now() - new Date(child.lastLocation.recorded_at).getTime())
            : 0;
          const isStill = child.lastLocation.activityType === 'still';
          const isStale = locAge > 45000;
          const effectiveSpeed = (isStill || isStale)
            ? 0.0
            : (child.lastLocation.speed != null ? Number(child.lastLocation.speed) : (child.isOnline ? 0.0 : null));

          locs[child.id] = {
            lat: child.lastLocation.lat,
            lng: child.lastLocation.lng,
            accuracy: child.lastLocation.accuracy,
            speed: effectiveSpeed,
            heading: child.lastLocation.heading,
            batteryLevel: child.lastLocation.battery_level,
            isCharging: child.lastLocation.is_charging,
            activityType: child.lastLocation.activityType || (child.isOnline ? 'still' : null),
            recordedAt: child.lastLocation.recorded_at,
          };
        } else if (child.device_id) {
          locs[child.id] = {
            speed: child.isOnline ? 0.0 : null,
            recordedAt: child.last_seen,
          };
        }
      }
      setLiveLocations(locs);

      const targetId = selectedChildId || (data.children.length > 0 ? data.children[0].id : null);
      if (!selectedChildId && targetId) {
        setSelectedChildId(targetId);
      }

      // Auto-center map to the child
      if (targetId && locs[targetId] && mapRef.current?.recenter) {
        mapRef.current.recenter(locs[targetId].lat, locs[targetId].lng, 16);
      }
    } catch (err) {
      console.error('Map load children error:', err);
    }
  };

  const focusChild = (childId) => {
    setSelectedChildId(childId);
    setRecentTrail([]);
    const targetChild = children.find((c) => c.id === childId);
    if (targetChild && mapRef.current?.updateChild) {
      mapRef.current.updateChild(targetChild);
    }
    const loc = liveLocations[childId];
    if (loc && mapRef.current?.recenter) {
      mapRef.current.recenter(loc.lat, loc.lng);
    }
  };

  const cycleTileLayer = () => {
    const keys = Object.keys(TILE_LAYERS);
    const nextIdx = (keys.indexOf(currentLayer) + 1) % keys.length;
    setCurrentLayer(keys[nextIdx]);
  };

  const selectedChild = children.find((c) => c.id === selectedChildId);
  const selectedLoc = selectedChildId ? liveLocations[selectedChildId] : null;

  const getMovementStatus = () => {
    if (!selectedLoc) return { isMoving: false, text: 'Waiting for device...', shortText: 'Waiting...' };

    const locAge = selectedLoc?.recordedAt
      ? Math.abs(nowTime - new Date(selectedLoc.recordedAt).getTime())
      : 0;
    const isStale = locAge > 45000;
    const activity = selectedLoc?.activityType;
    const isStill = activity === 'still';
    const currentSpeedKmh = (!isStale && selectedLoc?.speed != null)
      ? Number(selectedLoc.speed) * 3.6
      : 0;
    const isActivityMoving = !isStale && !isStill && activity && ['walking', 'running', 'in_vehicle', 'on_bicycle'].includes(activity);
    // Cardinal rule: A device is only moving if it has actual speed >= 1.2 km/h. At 0.0 km/h it is strictly stationary.
    const isMoving = currentSpeedKmh >= 1.2 || (isActivityMoving && currentSpeedKmh >= 0.8);

    if (isMoving) {
      let mode = 'Moving';
      let icon = 'walk-outline';
      let emoji = '🚶';
      if (activity === 'in_vehicle' || currentSpeedKmh >= 18.0) {
        mode = 'In Vehicle';
        icon = 'car-outline';
        emoji = '🚗';
      } else if (activity === 'on_bicycle' || (!activity && currentSpeedKmh >= 12.0)) {
        mode = 'Cycling';
        icon = 'bicycle-outline';
        emoji = '🚴';
      } else if ((activity === 'running' && currentSpeedKmh >= 7.0) || (!activity && currentSpeedKmh >= 7.5)) {
        mode = 'Running';
        icon = 'fitness-outline';
        emoji = '🏃';
      } else {
        mode = 'Walking';
        icon = 'walk-outline';
        emoji = '🚶';
      }

      const speedStr = currentSpeedKmh >= 1.5 ? ` · ${currentSpeedKmh.toFixed(1)} km/h` : '';
      const unifiedLabel = `${mode}${speedStr}`;

      return {
        isMoving: true,
        activityType: activity,
        icon,
        emoji,
        text: unifiedLabel,
        shortText: `${emoji} ${unifiedLabel}`,
      };
    }
    if (!isMoving && activity === 'in_vehicle' && !isStale) {
      const stopDiffMs = stationarySince ? Math.max(0, nowTime - new Date(stationarySince).getTime()) : 0;
      if (stopDiffMs < 75000) {
        return {
          isMoving: false,
          activityType: 'in_vehicle',
          icon: 'car-outline',
          emoji: '🚗',
          text: 'In Vehicle · Stopped (Traffic / Junction)',
          shortText: '🚗 In Vehicle · Stopped',
        };
      }
    }
    if (!isMoving && activity === 'on_bicycle' && !isStale) {
      const stopDiffMs = stationarySince ? Math.max(0, nowTime - new Date(stationarySince).getTime()) : 0;
      if (stopDiffMs < 60000) {
        return {
          isMoving: false,
          activityType: 'on_bicycle',
          icon: 'bicycle-outline',
          emoji: '🚴',
          text: 'Cycling · Stopped (Traffic / Junction)',
          shortText: '🚴 Cycling · Stopped',
        };
      }
    }

    let startTime = stationarySince || (selectedLoc?.recordedAt ? new Date(selectedLoc.recordedAt) : null);
    if (!startTime || isNaN(startTime.getTime())) {
      return {
        isMoving: false,
        icon: 'pause-circle',
        emoji: '📍',
        text: 'Stationary · At this location',
        shortText: '📍 Stationary',
      };
    }

    const childCreated = selectedChild?.created_at ? new Date(selectedChild.created_at) : null;
    if (childCreated && !isNaN(childCreated.getTime()) && startTime < childCreated) {
      startTime = childCreated;
    }

    const diffMs = Math.max(0, nowTime - startTime.getTime());
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) {
      return {
        isMoving: false,
        icon: 'pause-circle',
        emoji: '📍',
        text: 'Stationary · Just arrived',
        shortText: '📍 Stationary',
      };
    }

    let durationText = '';
    if (mins === 1) {
      durationText = '1 min';
    } else if (mins < 60) {
      durationText = `${mins} mins`;
    } else {
      const hours = Math.floor(mins / 60);
      const remMins = mins % 60;
      durationText = `${hours}h ${remMins > 0 ? `${remMins}m` : ''}`.trim();
    }

    const arrivedAtTime = format(startTime, 'h:mm a');
    return {
      isMoving: false,
      dwellMins: mins,
      durationText,
      arrivedAtTime,
      icon: mins >= 5 ? 'business' : 'pause-circle',
      emoji: '📍',
      text: `Stationary for ${durationText} (since ${arrivedAtTime})`,
      shortText: `📍 Stationary (${durationText})`,
    };
  };
  const movementStatus = getMovementStatus();

  const getLastUpdatedDateTime = () => {
    const ts = selectedLoc?.recordedAt || selectedChild?.lastLocation?.recorded_at || selectedChild?.last_seen;
    if (!ts) return null;
    try {
      const d = new Date(ts);
      if (isNaN(d.getTime())) return null;
      if (isToday(d)) {
        return `Today, ${format(d, 'h:mm:ss a')}`;
      }
      return format(d, 'MMM d, yyyy h:mm a');
    } catch {
      return null;
    }
  };
  const lastUpdatedDateTime = getLastUpdatedDateTime();

  const initialRegion = selectedLoc
    ? { latitude: selectedLoc.lat, longitude: selectedLoc.lng, latitudeDelta: 0.008, longitudeDelta: 0.008 }
    : { latitude: 6.4157, longitude: 80.0008, latitudeDelta: 0.02, longitudeDelta: 0.02 }; // Default to current known child vicinity


  return (
    <View style={styles.container}>
      {/* 100% Genuine OpenStreetMap Engine via Leaflet - No Google logo, zero API key dependency */}
      <OSMMapView
        ref={mapRef}
        child={selectedChild}
        location={selectedLoc}
        parentLocation={parentLocation}
        onParentLocation={setParentLocation}
        recentTrail={showTrail ? recentTrail : []}
        mapStyle={currentLayer}
        statusMessage={movementStatus?.shortText || ''}
        onMapReady={() => {
          setMapReady(true);
          if (selectedChild) {
            mapRef.current?.updateChild?.(selectedChild);
          }
          if (movementStatus?.shortText) {
            mapRef.current?.updateStatusTag?.(movementStatus.shortText);
          }
          Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }).start();
        }}
      />

      {/* Top Header Section (Pill buttons + alerts) */}
      <View style={styles.topSection} pointerEvents="box-none">
        {/* Top Header Row with Title + You Toggle + Trail Toggle */}
        <View style={styles.headerRow}>
          <View style={styles.liveMapHeader}>
            <View style={styles.livePulseDot} />
            <Text style={styles.liveMapTitle}>Live Map</Text>
          </View>

          <View style={styles.headerRightActions}>
            <TouchableOpacity
              style={[styles.headerPillBtn, showParentLocation ? styles.headerPillBtnActive : styles.headerPillBtnOff]}
              onPress={toggleParentLocation}
              activeOpacity={0.8}
            >
              <Icon
                name={showParentLocation ? 'person' : 'person-outline'}
                size={15}
                color="#FFFFFF"
              />
              <Text style={[styles.headerPillText, showParentLocation ? styles.headerPillTextBlue : styles.headerPillTextOff]}>
                {showParentLocation ? 'You' : 'You: Off'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.headerPillBtn, showTrail ? styles.headerPillBtnActivePurple : styles.headerPillBtnOff]}
              onPress={() => setShowTrail((prev) => !prev)}
              activeOpacity={0.8}
            >
              <Icon
                name={showTrail ? 'footsteps' : 'footsteps-outline'}
                size={15}
                color="#FFFFFF"
              />
              <Text style={[styles.headerPillText, showTrail ? styles.headerPillTextPurple : styles.headerPillTextOff]}>
                {showTrail ? 'Trail' : 'Trail: Off'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Map Layers: 3 Square Radio Buttons (Satellite, Street, OSM) right-side aligned */}
        <View style={styles.layerSelectorRow} pointerEvents="box-none">
          <View style={styles.layerSelectorCard}>
            {MAP_LAYER_OPTIONS.map((layer) => {
              const isSelected = currentLayer === layer.id;
              return (
                <TouchableOpacity
                  key={layer.id}
                  style={[
                    styles.layerSquareBtn,
                    isSelected ? styles.layerSquareBtnActive : styles.layerSquareBtnInactive,
                  ]}
                  onPress={() => setCurrentLayer(layer.id)}
                  activeOpacity={0.8}
                >
                  <Image source={layer.image} style={styles.layerThumbImg} resizeMode="cover" />
                  {isSelected && (
                    <View style={styles.layerCheckBadge}>
                      <Icon name="checkmark" size={9} color="#0B132B" />
                    </View>
                  )}
                  <View style={[styles.layerLabelWrap, isSelected && styles.layerLabelWrapActive]}>
                    <Text
                      style={[
                        styles.layerLabelText,
                        isSelected ? styles.layerLabelTextActive : styles.layerLabelTextInactive,
                      ]}
                      numberOfLines={1}
                    >
                      {layer.label}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Low Battery Warning Banner */}
        {lowBatteryAlert && (
          <View style={styles.lowBattAlert}>
            <View style={styles.lowBattIconWrap}>
              <Icon name="battery-dead" size={18} color="#EF4444" />
            </View>
            <View style={styles.lowBattInfo}>
              <Text style={styles.lowBattTitle}>
                Low Battery Alert • {lowBatteryAlert.childName} ({lowBatteryAlert.batteryLevel}%)
              </Text>
              <Text style={styles.lowBattDesc}>
                Battery is below 20%. Please remind your child to connect a charger!
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => setLowBatteryAlert(null)}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Icon name="close" size={18} color={Colors.text.tertiary} />
            </TouchableOpacity>
          </View>
        )}

        {/* Offline / Services Disabled Notice */}
        {selectedChild && !selectedChild.isOnline && (
          <View style={styles.offlineNotice}>
            <Icon name="alert-circle" size={15} color="#F59E0B" />
            <Text style={styles.offlineNoticeText}>
              Child device is offline or Location Services (GPS) are turned off.
            </Text>
          </View>
        )}

        {/* Child selector tabs */}
        {children.length > 1 && (
          <View style={styles.selectorRow}>
            {children.map((child) => {
              const isOnline = !!liveLocations[child.id];
              const color = child.avatar_color || Colors.brand.primary;
              const isSelected = child.id === selectedChildId;
              return (
                <TouchableOpacity
                  key={child.id}
                  style={[styles.selectorTab, isSelected && { borderColor: color, backgroundColor: `${color}20` }]}
                  onPress={() => focusChild(child.id)}
                  activeOpacity={0.8}
                >
                  <View style={[styles.selectorDot, { backgroundColor: isOnline ? Colors.status.online : Colors.status.offline }]} />
                  <Text style={[styles.selectorText, isSelected && { color }]} numberOfLines={1}>
                    {child.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </View>

      {/* Bottom Section containing FABs and Details Card */}
      <View style={styles.bottomSection} pointerEvents="box-none">
          {/* FAB buttons: My Location + View Both + Child */}
          <View style={styles.fabStack}>
            {parentLocation && selectedLoc?.lat != null && (
              <TouchableOpacity
                style={styles.fabBtnSecondary}
                onPress={() => mapRef.current?.fitBoth()}
                activeOpacity={0.85}
              >
                <Icon name="expand-outline" size={18} color="#fff" />
                <Text style={styles.fabBtnSecondaryText}>Both</Text>
              </TouchableOpacity>
            )}
            {parentLocation && (
              <TouchableOpacity
                style={[styles.fabBtnSecondary, styles.fabBtnBlue]}
                onPress={() => mapRef.current?.recenterParent()}
                activeOpacity={0.85}
              >
                <Icon name="navigate" size={18} color="#fff" />
                <Text style={styles.fabBtnSecondaryText}>Me</Text>
              </TouchableOpacity>
            )}
            {selectedChild && (
              <TouchableOpacity
                style={[styles.fabBtnSecondary, styles.fabBtnPurple]}
                onPress={() => setSnapshotModalVisible(true)}
                activeOpacity={0.85}
              >
                <Icon name="radio-outline" size={18} color="#fff" />
                <Text style={styles.fabBtnSecondaryText}>Listen</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.fabBtnChild}
              onPress={() => {
                const loc = selectedChildId ? liveLocations[selectedChildId] : null;
                if (loc?.lat != null) mapRef.current?.recenter(loc.lat, loc.lng);
              }}
              activeOpacity={0.85}
            >
              <Icon name="locate" size={20} color="#fff" />
              <Text style={styles.fabBtnChildText}>Child</Text>
            </TouchableOpacity>
          </View>

          {/* Bottom info card for selected child (tap to recenter) */}
          {selectedChild && (
            <TouchableOpacity
              style={styles.bottomCard}
              onPress={() => focusChild(selectedChildId)}
              activeOpacity={0.92}
            >
              <View style={styles.dragHandle} />

              <View style={styles.bottomRow}>
                <View style={styles.bottomAvatarWrap}>
                  {selectedChild.avatar_url ? (
                    <Image
                      source={{ uri: selectedChild.avatar_url }}
                      style={styles.bottomAvatarImg}
                    />
                  ) : (
                    <View style={[styles.bottomAvatarFallback, { backgroundColor: `${selectedChild.avatar_color || Colors?.brand?.primary || '#6C63FF'}30` }]}>
                      <Text style={[styles.bottomAvatarText, { color: selectedChild.avatar_color || Colors?.brand?.primary || '#6C63FF' }]}>
                        {selectedChild.name[0]}
                      </Text>
                    </View>
                  )}
                </View>

                <View style={styles.bottomInfo}>
                  <Text style={styles.bottomName}>{selectedChild.name}</Text>
                  <View style={styles.coordsRow}>
                    <Icon name="location-sharp" size={14} color="#818CF8" />
                    <Text style={styles.bottomCoords}>
                      {selectedLoc?.lat != null && selectedLoc?.lng != null
                        ? `${selectedLoc.lat.toFixed(5)}, ${selectedLoc.lng.toFixed(5)}`
                        : 'Locating...'}
                    </Text>
                  </View>
                  <View style={styles.timeRow}>
                    <Icon name="time-outline" size={15} color="#818CF8" />
                    <Text style={styles.bottomTime}>
                      Updated: {lastUpdatedDateTime || 'Just now'}
                    </Text>
                  </View>
                </View>

                <View style={styles.bottomStats}>
                  <View style={styles.speedBadge}>
                    <Icon name="speedometer" size={15} color="#10B981" />
                    <Text style={styles.speedText}>
                      {(() => {
                        const locAge = selectedLoc?.recordedAt ? Math.abs(Date.now() - new Date(selectedLoc.recordedAt).getTime()) : 0;
                        const isStill = selectedLoc?.activityType === 'still';
                        const isStale = locAge > 45000;
                        const spd = (!isStill && !isStale && selectedLoc?.speed != null) ? Number(selectedLoc.speed) * 3.6 : 0;
                        return spd >= 2.2
                          ? `${spd.toFixed(1)} km/h`
                          : (selectedChild.isOnline ? '0.0 km/h' : '— km/h');
                      })()}
                    </Text>
                  </View>

                  {(() => {
                    const batt = selectedLoc?.batteryLevel ?? selectedChild.lastLocation?.battery_level;
                    const isCharging = selectedLoc?.isCharging ?? selectedChild.lastLocation?.is_charging;
                    if (batt == null) return null;
                    const iconName = isCharging
                      ? 'battery-charging'
                      : batt > 70
                      ? 'battery-full'
                      : batt > 30
                      ? 'battery-half'
                      : 'battery-dead';
                    return (
                      <View style={styles.battBadge}>
                        <Icon
                          name={iconName}
                          size={20}
                          color={batt > 20 ? '#10B981' : '#EF4444'}
                        />
                        <Text style={styles.battText}>{batt}%</Text>
                      </View>
                    );
                  })()}
                </View>
              </View>

              {/* Stationary / Movement / Dwell Status Message Banner */}
              {movementStatus?.text && (
                <View style={styles.statusBanner}>
                  <View style={[styles.statusIconWrap, movementStatus.isMoving && styles.statusIconWrapMoving]}>
                    <Icon
                      name={movementStatus.isMoving ? (movementStatus.icon || 'walk') : 'business'}
                      size={20}
                      color={movementStatus.isMoving ? '#10B981' : '#A78BFA'}
                    />
                  </View>
                  <Text style={styles.statusBannerText} numberOfLines={1}>
                    {movementStatus.text}
                  </Text>
                  <Icon name="chevron-forward" size={17} color="#94A3B8" />
                </View>
              )}
            </TouchableOpacity>
          )}
        </View>

      {/* Safety Snapshot Modal */}
      {selectedChild && (
        <SnapshotModal
          visible={snapshotModalVisible}
          child={selectedChild}
          onClose={() => setSnapshotModalVisible(false)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg.primary,
  },
  topSection: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    elevation: 100,
  },
  bottomSection: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingBottom: Platform.OS === 'ios' ? 104 : 96,
    zIndex: 100,
    elevation: 100,
  },
  fabStack: {
    alignSelf: 'flex-end',
    marginRight: Spacing.xl,
    marginBottom: Spacing.sm,
    alignItems: 'center',
    gap: 8,
  },
  fabBtnChild: {
    backgroundColor: '#6366F1',
    borderRadius: 26,
    paddingHorizontal: 20,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    shadowColor: '#6366F1',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.6,
    shadowRadius: 14,
    elevation: 10,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.35)',
  },
  fabBtnChildText: {
    fontFamily: Fonts.bold,
    fontSize: 14.5,
    color: '#fff',
    letterSpacing: 0.2,
  },
  fabBtnSecondary: {
    backgroundColor: 'rgba(15, 23, 42, 0.94)',
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 7,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.25)',
  },
  fabBtnBlue: {
    backgroundColor: 'rgba(2, 132, 199, 0.92)',
    borderColor: 'rgba(56, 189, 248, 0.4)',
  },
  fabBtnPurple: {
    backgroundColor: 'rgba(124, 58, 237, 0.94)',
    borderColor: 'rgba(168, 85, 247, 0.45)',
  },
  fabBtnSecondaryText: {
    fontFamily: Fonts.bold,
    fontSize: 12.5,
    color: '#fff',
  },

  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    marginTop: Platform.OS === 'ios' ? 54 : 46,
    flexWrap: 'nowrap',
  },
  liveMapHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: 'rgba(15, 23, 42, 0.82)',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.14)',
  },
  livePulseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#10B981',
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 5,
    elevation: 3,
  },
  liveMapTitle: {
    fontFamily: Fonts.bold,
    fontSize: 14,
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },
  headerRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerPillBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(15, 23, 42, 0.92)',
    borderRadius: 20,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.3)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 4,
  },
  headerPillBtnActive: {
    borderColor: '#38BDF8',
    backgroundColor: '#0284C7',
  },
  headerPillBtnActivePurple: {
    borderColor: '#A5B4FC',
    backgroundColor: '#4F46E5',
  },
  headerPillBtnOff: {
    borderColor: 'rgba(255, 255, 255, 0.35)',
    backgroundColor: 'rgba(15, 23, 42, 0.96)',
  },
  headerPillText: {
    fontFamily: Fonts.bold,
    fontSize: 13.5,
    color: '#FFFFFF',
  },
  headerPillTextBlue: {
    color: '#FFFFFF',
  },
  headerPillTextPurple: {
    color: '#FFFFFF',
  },
  headerPillTextOff: {
    color: '#FFFFFF',
  },

  layerSelectorRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 14,
    marginTop: 8,
  },
  layerSelectorCard: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: 'rgba(15, 23, 42, 0.88)',
    padding: 5,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.45,
    shadowRadius: 6,
    elevation: 6,
  },
  layerSquareBtn: {
    width: 50,
    height: 50,
    borderRadius: 10,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    backgroundColor: '#1E293B',
  },
  layerSquareBtnActive: {
    borderWidth: 2,
    borderColor: '#38BDF8',
    shadowColor: '#38BDF8',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.7,
    shadowRadius: 5,
  },
  layerSquareBtnInactive: {
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    opacity: 0.82,
  },
  layerThumbImg: {
    width: '100%',
    height: '100%',
    borderRadius: 8,
  },
  layerCheckBadge: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#38BDF8',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.5,
    shadowRadius: 2,
    elevation: 3,
  },
  layerLabelWrap: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.88)',
    paddingVertical: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  layerLabelWrapActive: {
    backgroundColor: 'rgba(14, 116, 144, 0.95)',
  },
  layerLabelText: {
    fontSize: 8.5,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  layerLabelTextActive: {
    fontFamily: Fonts.bold,
    color: '#38BDF8',
    fontWeight: '700',
  },
  layerLabelTextInactive: {
    fontFamily: Fonts.bold,
    color: '#94A3B8',
    fontWeight: '600',
  },

  offlineNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: Spacing.xl,
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.35)',
    borderRadius: Radius.md,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: Spacing.sm,
  },
  offlineNoticeText: {
    fontFamily: Fonts.medium,
    fontSize: 12,
    color: '#F59E0B',
    flex: 1,
    lineHeight: 16,
  },

  selectorRow: {
    flexDirection: 'row',
    marginHorizontal: Spacing.xl,
    gap: Spacing.sm,
    flexWrap: 'wrap',
  },
  selectorTab: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.bg.glass,
    borderRadius: Radius.full, paddingHorizontal: 14, paddingVertical: 8,
    borderWidth: 1, borderColor: Colors.bg.glassBorder,
  },
  selectorDot: { width: 7, height: 7, borderRadius: 4 },
  selectorText: { fontFamily: Fonts.medium, fontSize: Fonts.sizes.sm, color: Colors.text.secondary, maxWidth: 100 },

  bottomCard: {
    marginHorizontal: Spacing.xl,
    marginBottom: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.88)',
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.22)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.45,
    shadowRadius: 16,
    elevation: 12,
  },
  dragHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.35)',
    alignSelf: 'center',
    marginBottom: 12,
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  bottomAvatarWrap: {
    width: 66,
    height: 66,
    borderRadius: 33,
    borderWidth: 2,
    borderColor: '#38BDF8',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.8)',
  },
  bottomAvatarImg: {
    width: '100%',
    height: '100%',
  },
  bottomAvatarFallback: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomAvatarText: {
    fontFamily: Fonts.bold,
    fontSize: 22,
  },
  bottomInfo: {
    flex: 1,
    marginLeft: 12,
    justifyContent: 'center',
  },
  bottomName: {
    fontFamily: Fonts.bold,
    fontSize: 18,
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  coordsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 3,
  },
  bottomCoords: {
    fontFamily: Fonts.medium,
    fontSize: 12,
    color: '#94A3B8',
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  bottomTime: {
    fontFamily: Fonts.medium,
    fontSize: 12,
    color: '#94A3B8',
  },
  bottomStats: {
    alignItems: 'flex-end',
    gap: 8,
  },
  speedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
    borderRadius: Radius.full,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  speedText: {
    fontFamily: Fonts.bold,
    fontSize: 12,
    color: '#10B981',
  },
  battBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: Radius.full,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  battText: {
    fontFamily: Fonts.bold,
    fontSize: 12,
    color: '#FFFFFF',
  },
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(99, 102, 241, 0.12)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(99, 102, 241, 0.25)',
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginTop: 12,
    gap: 8,
  },
  statusIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(99, 102, 241, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusIconWrapMoving: {
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
  },
  statusBannerText: {
    flex: 1,
    fontFamily: Fonts.semiBold,
    fontSize: 12,
    color: '#E2E8F0',
  },
  lowBattAlert: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: Spacing.xl,
    backgroundColor: 'rgba(239, 68, 68, 0.18)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.45)',
    borderRadius: Radius.lg,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: Spacing.sm,
  },
  lowBattIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(239, 68, 68, 0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lowBattInfo: { flex: 1 },
  lowBattTitle: {
    fontFamily: Fonts.bold,
    fontSize: 13,
    color: '#EF4444',
  },
  lowBattDesc: {
    fontFamily: Fonts.medium,
    fontSize: 11,
    color: '#FCA5A5',
    marginTop: 1,
  },
});
