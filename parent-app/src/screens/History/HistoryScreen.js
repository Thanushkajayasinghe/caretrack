import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Animated, ActivityIndicator, Dimensions, Modal, Alert,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons as Icon } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { format, startOfDay, subHours, subDays, isToday, isYesterday,
  startOfMonth, endOfMonth, eachDayOfInterval, getDay, addMonths, subMonths, isSameDay } from 'date-fns';
import { Colors, Fonts, Spacing, Radius } from '../../theme/tokens';
import { childAPI, locationAPI } from '../../services/api';
import OSMHistoryMapView from '../../components/OSMHistoryMapView';
import { activateKeepAwake, deactivateKeepAwake } from '../../utils/keepAwake';
import { segmentHistoryPoints } from '../../utils/tripSegmentation';
import HistoryTimelineSheet from '../../components/HistoryTimelineSheet';
import { snapPointsToRoads } from '../../services/roadSnapping'; // backup — kept but not used
import { smoothGPSTrail } from '../../utils/gpsSmooth';

const { width } = Dimensions.get('window');

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371e3;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDatetimeLabel(d) {
  if (!d) return '';
  if (isToday(d)) {
    return `Today, ${format(d, 'h:mm a')}`;
  } else if (isYesterday(d)) {
    return `Yesterday, ${format(d, 'h:mm a')}`;
  }
  return format(d, 'MMM d, h:mm a');
}

// ─── Scroll Wheel Column ─────────────────────────────────────────────────────
const ITEM_H = 44;
const VISIBLE = 5; // items visible in the window

// Stable item arrays (never recreated)
const HOUR_ITEMS = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));
const MIN_ITEMS  = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'));
const AMPM_ITEMS = ['AM', 'PM'];

function PickerColumn({ items, selectedIndex, onSelect, style }) {
  const ref = useRef(null);
  const isScrolling = useRef(false); // true while user finger is on screen
  const committedIdx = useRef(selectedIndex);

  // Scroll to initial position instantly on first mount
  useEffect(() => {
    ref.current?.scrollTo({ y: selectedIndex * ITEM_H, animated: false });
    committedIdx.current = selectedIndex;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync position when parent changes index (e.g. AM/PM flip changes hour)
  // Only do this when the user is NOT currently scrolling
  useEffect(() => {
    if (!isScrolling.current && selectedIndex !== committedIdx.current) {
      ref.current?.scrollTo({ y: selectedIndex * ITEM_H, animated: true });
      committedIdx.current = selectedIndex;
    }
  }, [selectedIndex]);

  const handleScrollBegin = () => {
    isScrolling.current = true;
  };

  const handleMomentumEnd = (e) => {
    const raw = e.nativeEvent.contentOffset.y;
    const idx = Math.max(0, Math.min(Math.round(raw / ITEM_H), items.length - 1));
    isScrolling.current = false;
    committedIdx.current = idx;
    // Snap precisely to grid
    ref.current?.scrollTo({ y: idx * ITEM_H, animated: false });
    onSelect(idx);
  };

  return (
    <View style={[pickerColStyle.wrap, style]}>
      {/* Selection highlight bar */}
      <View style={pickerColStyle.selector} pointerEvents="none" />
      {/* Fade masks over top/bottom items */}
      <View style={pickerColStyle.fadeTop} pointerEvents="none" />
      <View style={pickerColStyle.fadeBottom} pointerEvents="none" />

      <ScrollView
        ref={ref}
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM_H}
        decelerationRate="fast"
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingVertical: ITEM_H * Math.floor(VISIBLE / 2) }}
        onScrollBeginDrag={handleScrollBegin}
        onMomentumScrollEnd={handleMomentumEnd}
        nestedScrollEnabled
      >
        {items.map((label, idx) => {
          const isSelected = idx === selectedIndex;
          return (
            <TouchableOpacity
              key={idx}
              style={pickerColStyle.item}
              onPress={() => {
                isScrolling.current = false;
                committedIdx.current = idx;
                ref.current?.scrollTo({ y: idx * ITEM_H, animated: true });
                onSelect(idx);
              }}
              activeOpacity={0.7}
            >
              <Text style={[pickerColStyle.itemText, isSelected && pickerColStyle.itemTextSelected]}>
                {label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const pickerColStyle = StyleSheet.create({
  wrap: {
    height: ITEM_H * VISIBLE,
    overflow: 'hidden',
    position: 'relative',
  },
  selector: {
    position: 'absolute',
    top: ITEM_H * Math.floor(VISIBLE / 2),
    left: 0, right: 0,
    height: ITEM_H,
    backgroundColor: 'rgba(108, 99, 255, 0.18)',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: 'rgba(108, 99, 255, 0.55)',
    zIndex: 2,
  },
  fadeTop: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    height: ITEM_H * Math.floor(VISIBLE / 2),
    backgroundColor: 'rgba(17,24,39,0.62)',
    zIndex: 3,
  },
  fadeBottom: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    height: ITEM_H * Math.floor(VISIBLE / 2),
    backgroundColor: 'rgba(17,24,39,0.62)',
    zIndex: 3,
  },
  item: {
    height: ITEM_H,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemText: {
    fontFamily: 'sans-serif',
    fontSize: 18,
    color: 'rgba(209,213,219,0.45)',
  },
  itemTextSelected: {
    fontSize: 24,
    fontWeight: '700',
    color: '#F9FAFB',
  },
});

// ─────────────────────────────────────────────────────────────────────────────
export default function HistoryScreen({ route }) {
  const initialChildId = route?.params?.childId;

  const [children, setChildren] = useState([]);
  const [selectedChildId, setSelectedChildId] = useState(initialChildId || null);

  // Datetime Range state - default: today start (00:00:00) to current time
  const [fromDateTime, setFromDateTime] = useState(startOfDay(new Date()));
  const [toDateTime, setToDateTime] = useState(new Date());
  const [isCustomToDate, setIsCustomToDate] = useState(false);

  const [points, setPoints] = useState([]);
  const [allPoints, setAllPoints] = useState([]);
  const [roadCoordinates, setRoadCoordinates] = useState([]);   // kept for backup compat
  const [isRoadSnappingActive] = useState(false);               // road snapping disabled — using GPS smoothing
  const [smoothedPoints, setSmoothedPoints] = useState([]);     // smooth GPS trail (replaces OSRM)
  const [timelineData, setTimelineData] = useState({ timeline: [], trips: [], stops: [] });
  const [selectedTripId, setSelectedTripId] = useState(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playSpeed, setPlaySpeed] = useState(1); // 1x, 2x, 5x
  const [hasQueried, setHasQueried] = useState(false);
  const [filtersCollapsed, setFiltersCollapsed] = useState(false);

  // Time picker modal state
  const [pickerModalVisible, setPickerModalVisible] = useState(false);
  const [pickerTarget, setPickerTarget] = useState('from'); // 'from' or 'to'
  const [tempDate, setTempDate] = useState(new Date());
  // Calendar navigation: which month/year is shown in the picker
  const [calendarViewDate, setCalendarViewDate] = useState(new Date());

  // Build calendar grid as rows of 7 (Mon-first)
  const buildCalendarGrid = (viewDate) => {
    const start = startOfMonth(viewDate);
    const end = endOfMonth(viewDate);
    const days = eachDayOfInterval({ start, end });
    // Monday-first offset: Mon=0 … Sun=6
    const offset = (getDay(start) + 6) % 7;
    const cells = Array(offset).fill(null).concat(days);
    while (cells.length % 7 !== 0) cells.push(null);
    // Split into weeks
    const weeks = [];
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
    return weeks;
  };

  const playTimerRef = useRef(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;

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

  // Clean up timer on unmount
  useEffect(() => {
    return () => clearInterval(playTimerRef.current);
  }, []);

  // Smooth GPS trail with Douglas-Peucker + Catmull-Rom (replaces OSRM road snapping)
  useEffect(() => {
    if (!points || points.length < 2) {
      setSmoothedPoints([]);
      return;
    }
    // Synchronous — runs instantly on device, no network needed
    const smooth = smoothGPSTrail(points);
    setSmoothedPoints(smooth);
  }, [points]);

  const loadChildren = async () => {
    try {
      const { data } = await childAPI.list();
      setChildren(data.children || []);
      if (!selectedChildId && data.children.length > 0) {
        setSelectedChildId(data.children[0].id);
      }
    } catch (e) {
      console.error('Failed to load children:', e);
    }
  };

  // Fetch points when user clicks "View"
  const handleViewRoute = async () => {
    if (!selectedChildId) {
      Alert.alert('Notice', 'Please select a child profile first.');
      return;
    }

    // If toDateTime tracks current ongoing activity (not a past date), refresh to right now
    let queryTo = toDateTime;
    if (!isCustomToDate) {
      queryTo = new Date();
      setToDateTime(queryTo);
    }

    if (fromDateTime >= queryTo) {
      Alert.alert('Invalid Range', 'Start time must be earlier than end time.');
      return;
    }

    setLoading(true);
    setHasQueried(true);
    setIsPlaying(false);
    clearInterval(playTimerRef.current);
    setCurrentIndex(0);

    try {
      const { data } = await locationAPI.history({
        childId: selectedChildId,
        from: fromDateTime.toISOString(),
        to: queryTo.toISOString(),
        limit: 2000,
        _t: Date.now(),
      });

      const rawPoints = data.points || [];
      const fetched = rawPoints.map((pt, idx, arr) => {
        let spd = (pt.speed != null && !isNaN(Number(pt.speed))) ? Number(pt.speed) : 0;
        if (idx > 0) {
          const prev = arr[idx - 1];
          const dist = haversine(prev.lat, prev.lng, pt.lat, pt.lng);
          const dt = Math.max(0.5, (new Date(pt.recorded_at) - new Date(prev.recorded_at)) / 1000);
          const spatialSpeed = dist / dt;

          // GPS Doppler spike rejector:
          // If displacement from previous fix is small (< 25m) or spatial velocity is low (< 2.0 m/s),
          // physical speed cannot be > 2.0 m/s (~7.2 km/h, i.e. walking/running transition).
          if (spd > 2.2 && (dist < 25.0 || spatialSpeed < 2.0)) {
            spd = Math.min(spd, Math.max(spatialSpeed, 1.4));
          }
        }
        // Only infer speed if speed was completely missing/null (NOT 0) AND physical displacement is genuine (>= 25m)
        if (pt.speed == null && idx > 0) {
          const prev = arr[idx - 1];
          const dist = haversine(prev.lat, prev.lng, pt.lat, pt.lng);
          const dt = (new Date(pt.recorded_at) - new Date(prev.recorded_at)) / 1000;
          if (dt >= 1 && dt <= 120 && dist >= 25.0) {
            spd = Math.min(dist / dt, 25);
          } else {
            spd = 0;
          }
        }
        return { ...pt, speed: spd };
      });

      const segmented = segmentHistoryPoints(fetched);
      setAllPoints(fetched);
      setTimelineData(segmented);
      setSelectedTripId(null);
      setPoints(fetched);

      if (fetched.length > 0) {
        setFiltersCollapsed(true);
        Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }).start();
      }
    } catch (err) {
      console.error('Failed to fetch history route:', err);
      Alert.alert('Error', 'Failed to load location history.');
    } finally {
      setLoading(false);
    }
  };

  // Animation playback loop
  const togglePlay = () => {
    if (isPlaying) {
      clearInterval(playTimerRef.current);
      setIsPlaying(false);
    } else {
      if (points.length <= 1) return;
      setIsPlaying(true);

      const intervalMs = Math.max(80, Math.floor(300 / playSpeed));

      // If at end, start over
      if (currentIndex >= points.length - 1) {
        setCurrentIndex(0);
      }

      playTimerRef.current = setInterval(() => {
        setCurrentIndex((prev) => {
          const next = prev + 1;
          if (next >= points.length) {
            clearInterval(playTimerRef.current);
            setIsPlaying(false);
            return points.length - 1;
          }
          return next;
        });
      }, intervalMs);
    }
  };

  // Handle play speed cycle (1x -> 2x -> 5x)
  const cycleSpeed = () => {
    const nextSpeed = playSpeed === 1 ? 2 : playSpeed === 2 ? 5 : 1;
    setPlaySpeed(nextSpeed);
    if (isPlaying) {
      clearInterval(playTimerRef.current);
      const intervalMs = Math.max(80, Math.floor(300 / nextSpeed));
      playTimerRef.current = setInterval(() => {
        setCurrentIndex((prev) => {
          const next = prev + 1;
          if (next >= points.length) {
            clearInterval(playTimerRef.current);
            setIsPlaying(false);
            return points.length - 1;
          }
          return next;
        });
      }, intervalMs);
    }
  };

  const handleReset = () => {
    clearInterval(playTimerRef.current);
    setIsPlaying(false);
    setCurrentIndex(0);
  };

  const handleSelectTrip = (trip) => {
    if (!trip || !trip.points) return;
    if (isPlaying) {
      clearInterval(playTimerRef.current);
      setIsPlaying(false);
    }
    setSelectedTripId(trip.id);
    setPoints(trip.points);
    setCurrentIndex(0);
  };

  const handleSelectAll = () => {
    if (isPlaying) {
      clearInterval(playTimerRef.current);
      setIsPlaying(false);
    }
    setSelectedTripId(null);
    setPoints(allPoints);
    setCurrentIndex(0);
  };

  const handleSelectStop = (stop) => {
    if (!stop || !stop.points) return;
    if (isPlaying) {
      clearInterval(playTimerRef.current);
      setIsPlaying(false);
    }
    if (selectedTripId !== null) {
      setSelectedTripId(null);
      setPoints(allPoints);
    }
    const stopTime = new Date(stop.startTime).getTime();
    const idx = allPoints.findIndex(
      (p) => Math.abs(new Date(p.recorded_at).getTime() - stopTime) < 5000
    );
    if (idx >= 0) {
      setCurrentIndex(idx);
    }
  };

  // Quick Preset Handlers
  const applyPreset = (preset) => {
    const now = new Date();
    if (preset === 'today') {
      setFromDateTime(startOfDay(now));
      setToDateTime(now);
      setIsCustomToDate(false);
    } else if (preset === '2h') {
      setFromDateTime(subHours(now, 2));
      setToDateTime(now);
      setIsCustomToDate(false);
    } else if (preset === '6h') {
      setFromDateTime(subHours(now, 6));
      setToDateTime(now);
      setIsCustomToDate(false);
    } else if (preset === 'yesterday') {
      const yStart = startOfDay(subDays(now, 1));
      const yEnd = new Date(yStart.getTime() + 86399000);
      setFromDateTime(yStart);
      setToDateTime(yEnd);
      setIsCustomToDate(true);
    }
  };

  // Open modal to configure From or To
  const openPicker = (target) => {
    setPickerTarget(target);
    const d = new Date(target === 'from' ? fromDateTime : toDateTime);
    setTempDate(d);
    setCalendarViewDate(d); // show the month of the current value
    setPickerModalVisible(true);
  };

  const savePickerValue = () => {
    if (pickerTarget === 'from') {
      setFromDateTime(tempDate);
    } else {
      setToDateTime(tempDate);
      setIsCustomToDate(true);
    }
    setPickerModalVisible(false);
  };

  // Stable time-wheel handlers (useCallback so PickerColumn never gets new refs)
  const applyHour = useCallback((idx) => {
    setTempDate(prev => {
      const d = new Date(prev);
      const h = idx + 1; // wheel is 01-12
      const ispm = d.getHours() >= 12;
      d.setHours(h === 12 ? (ispm ? 12 : 0) : h + (ispm ? 12 : 0));
      return d;
    });
  }, []);

  const applyMin = useCallback((idx) => {
    setTempDate(prev => {
      const d = new Date(prev);
      d.setMinutes(idx * 5);
      return d;
    });
  }, []);

  const applyAmpm = useCallback((idx) => {
    setTempDate(prev => {
      const d = new Date(prev);
      const h = d.getHours();
      if (idx === 0 && h >= 12) d.setHours(h - 12);
      if (idx === 1 && h < 12)  d.setHours(h + 12);
      return d;
    });
  }, []);

  // Derived indices for the wheels (recomputed on every tempDate change)
  const _rawH   = tempDate.getHours();
  const _h12    = _rawH % 12 === 0 ? 12 : _rawH % 12;
  const hourIdx = _h12 - 1;                                    // 0-11
  const minIdx  = Math.min(Math.round(tempDate.getMinutes() / 5), 11); // 0-11
  const ampmIdx = _rawH < 12 ? 0 : 1;                         // 0=AM,1=PM

  // Current active point during playback
  const currentPt = points[currentIndex] || null;

  const currentPtTimeStr = currentPt?.recorded_at
    ? format(new Date(currentPt.recorded_at), 'MMM d, yyyy · h:mm:ss a')
    : null;

  const currentPtSpeedKmh = currentPt?.speed != null
    ? (Number(currentPt.speed) * 3.6).toFixed(1)
    : '0.0';

  // Stats calculation
  let maxSpan = 0;
  for (let a = 0; a < points.length; a++) {
    for (let b = a + 1; b < points.length; b++) {
      const d = haversine(points[a].lat, points[a].lng, points[b].lat, points[b].lng);
      if (d > maxSpan) maxSpan = d;
    }
  }

  const cumulativeDistance = points.length > 1
    ? points.reduce((acc, pt, i) => {
        if (i === 0) return 0;
        return acc + haversine(points[i - 1].lat, points[i - 1].lng, pt.lat, pt.lng);
      }, 0)
    : 0;

  const maxSpeedMps = points.length > 0 ? Math.max(...points.map((p) => Number(p.speed || 0))) : 0;
  // Truly stationary only if the child never left a 12m desk circle AND total path length is < 15m with 0 speed
  const isStationaryRoute = maxSpan < 12.0 || (cumulativeDistance < 15.0 && maxSpeedMps < 0.6);

  const totalDistanceMeters = !isStationaryRoute ? cumulativeDistance : 0;

  const formattedDistance = isStationaryRoute
    ? '0 m (Stationary)'
    : (totalDistanceMeters < 1000
        ? `${Math.round(totalDistanceMeters)} m`
        : `${(totalDistanceMeters / 1000).toFixed(2)} km`);

  const maxSpeedKmh = isStationaryRoute
    ? '0.0'
    : (maxSpeedMps * 3.6).toFixed(1);

  const selectedChild = children.find((c) => c.id === selectedChildId);

  return (
    <View style={styles.container}>
      <LinearGradient colors={['#0A0E1A', '#111827']} style={StyleSheet.absoluteFill} />

      {/* Top Header - Compact & Space Efficient */}
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <View style={styles.headerTitleWrap}>
            <Text style={styles.headerTitle}>Trip History</Text>
            {points.length > 0 && (
              <View style={styles.headerPointCount}>
                <Text style={styles.headerPointCountText}>{points.length} pts</Text>
              </View>
            )}
          </View>

          {points.length > 0 && (
            <TouchableOpacity
              style={styles.headerToggleBtn}
              onPress={() => setFiltersCollapsed(!filtersCollapsed)}
              activeOpacity={0.8}
            >
              <Icon
                name={filtersCollapsed ? 'options-outline' : 'chevron-up'}
                size={14}
                color={Colors.brand.primary}
              />
              <Text style={styles.headerToggleText}>
                {filtersCollapsed ? 'Filter' : 'Hide'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* When Collapsed: Super Slim Range Strip (frees ~180px for map) */}
      {points.length > 0 && filtersCollapsed && (
        <TouchableOpacity
          style={styles.compactRangeBar}
          onPress={() => setFiltersCollapsed(false)}
          activeOpacity={0.8}
        >
          <View style={styles.compactRangeLeft}>
            <Icon name="calendar-outline" size={13} color={Colors.brand.primary} />
            <Text style={styles.compactRangeText} numberOfLines={1}>
              {format(fromDateTime, 'MMM d, h:mm a')} → {format(toDateTime, 'h:mm a')}
            </Text>
          </View>
          <View style={styles.compactRangeEditBtn}>
            <Icon name="pencil" size={11} color={Colors.brand.primary} />
            <Text style={styles.compactRangeEditText}>Edit</Text>
          </View>
        </TouchableOpacity>
      )}

      {/* Child Selector Tabs (Only when filters are expanded or before query) */}
      {children.length > 1 && (!filtersCollapsed || points.length === 0) && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.childSelector}
          contentContainerStyle={{ paddingHorizontal: Spacing.xl, gap: 8 }}
        >
          {children.map((child) => {
            const color = child.avatar_color || Colors.brand.primary;
            const isSelected = child.id === selectedChildId;
            return (
              <TouchableOpacity
                key={child.id}
                style={[styles.childTab, isSelected && { backgroundColor: `${color}20`, borderColor: `${color}60` }]}
                onPress={() => setSelectedChildId(child.id)}
                activeOpacity={0.8}
              >
                <Text style={[styles.childTabText, isSelected && { color }]}>{child.name}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      {/* DateTime Range Selector Card (Only when expanded) */}
      {(!filtersCollapsed || points.length === 0) && (
        <View style={styles.rangeCard}>
          <View style={styles.rangeRow}>
            {/* FROM button */}
            <TouchableOpacity style={styles.timeBlock} onPress={() => openPicker('from')} activeOpacity={0.75}>
              <View style={styles.blockHeader}>
                <Icon name="calendar-outline" size={13} color={Colors.brand.primary} />
                <Text style={styles.blockLabel}>FROM</Text>
              </View>
              <Text style={styles.blockValue} numberOfLines={1}>
                {formatDatetimeLabel(fromDateTime)}
              </Text>
            </TouchableOpacity>

            {/* Arrow Divider */}
            <View style={styles.arrowWrap}>
              <Icon name="arrow-forward" size={16} color={Colors.text.tertiary} />
            </View>

            {/* TO button */}
            <TouchableOpacity style={styles.timeBlock} onPress={() => openPicker('to')} activeOpacity={0.75}>
              <View style={styles.blockHeader}>
                <Icon name="time-outline" size={13} color={Colors.status.online} />
                <Text style={[styles.blockLabel, { color: Colors.status.online }]}>TO</Text>
              </View>
              <Text style={styles.blockValue} numberOfLines={1}>
                {formatDatetimeLabel(toDateTime)}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Quick presets row */}
          <View style={styles.presetsRow}>
            <TouchableOpacity style={styles.presetChip} onPress={() => applyPreset('today')}>
              <Text style={styles.presetText}>Today</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.presetChip} onPress={() => applyPreset('2h')}>
              <Text style={styles.presetText}>Last 2h</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.presetChip} onPress={() => applyPreset('6h')}>
              <Text style={styles.presetText}>Last 6h</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.presetChip} onPress={() => applyPreset('yesterday')}>
              <Text style={styles.presetText}>Yesterday</Text>
            </TouchableOpacity>
          </View>

          {/* Action button: View Route */}
          <TouchableOpacity style={styles.viewBtn} onPress={handleViewRoute} activeOpacity={0.85} disabled={loading}>
            <LinearGradient
              colors={[Colors.brand.primary, '#8B5CF6']}
              style={styles.viewBtnGrad}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
            >
              {loading ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <Icon name="eye-outline" size={18} color="#fff" />
                  <Text style={styles.viewBtnText}>View Route</Text>
                  {points.length > 0 && (
                    <View style={styles.countBadge}>
                      <Text style={styles.countBadgeText}>{points.length} pts</Text>
                    </View>
                  )}
                </>
              )}
            </LinearGradient>
          </TouchableOpacity>
        </View>
      )}

      {/* Main Map View & Floating Controls */}
      <View style={styles.mapContainer}>
        <OSMHistoryMapView
          points={points}
          currentIndex={currentIndex}
          isPlaying={isPlaying}
          playbackSpeed={playSpeed}
          roadCoordinates={[]}
          smoothedPoints={smoothedPoints}
          onPointChange={(idx) => setCurrentIndex(idx)}
        />

        {/* Empty state overlay before query or when 0 points */}
        {hasQueried && points.length === 0 && !loading && (
          <View style={styles.noDataOverlay}>
            <Icon name="map-outline" size={44} color={Colors.text.tertiary} />
            <Text style={styles.noDataTitle}>No location points found</Text>
            <Text style={styles.noDataSub}>
              No points recorded for {selectedChild?.name || 'this child'} in the selected time range.
            </Text>
          </View>
        )}

        {/* Floating Play & Active Point HUD on Map - Compact */}
        {points.length > 0 && (
          <View style={styles.floatingHUD}>
            {/* Compact info row */}
            <View style={styles.hudHeader}>
              <View style={styles.hudTimeCol}>
                <View style={styles.hudTimeRow}>
                  <Icon name="time-outline" size={12} color={Colors.brand.primary} />
                  <Text style={styles.hudTimeText} numberOfLines={1}>{currentPtTimeStr || 'Playback'}</Text>
                </View>
              </View>

              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <View style={styles.hudSpeedBadge}>
                  <Icon name="speedometer-outline" size={11} color={Colors.status.online} />
                  <Text style={styles.hudSpeedText}>{currentPtSpeedKmh} km/h</Text>
                </View>
              </View>
            </View>

            {/* Slider Scrubber */}
            <Slider
              style={styles.scrubber}
              minimumValue={0}
              maximumValue={Math.max(points.length - 1, 1)}
              step={1}
              value={currentIndex}
              onValueChange={(v) => setCurrentIndex(Math.round(v))}
              minimumTrackTintColor={Colors.brand.primary}
              maximumTrackTintColor={Colors.bg.glassBorder}
              thumbTintColor="#A78BFA"
            />

            {/* Compact Control row: reset | play | speed | pt count */}
            <View style={styles.hudControls}>
              <TouchableOpacity style={styles.hudAuxBtn} onPress={handleReset} activeOpacity={0.7}>
                <Icon name="refresh" size={16} color={Colors.text.secondary} />
              </TouchableOpacity>

              <TouchableOpacity style={styles.hudPlayBtn} onPress={togglePlay} activeOpacity={0.85}>
                <LinearGradient
                  colors={[Colors.brand.primary, '#8B5CF6']}
                  style={styles.hudPlayGrad}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                >
                  <Icon name={isPlaying ? 'pause' : 'play'} size={20} color="#fff" />
                </LinearGradient>
              </TouchableOpacity>

              <TouchableOpacity style={styles.hudSpeedBtn} onPress={cycleSpeed} activeOpacity={0.7}>
                <Text style={styles.hudSpeedBtnText}>{playSpeed}x</Text>
              </TouchableOpacity>

              <Text style={styles.hudPtCount}>{currentIndex + 1}/{points.length}</Text>
            </View>
          </View>
        )}
      </View>

      {/* Timeline Sheet (Trips & Stops Grouping) */}
      {allPoints.length > 0 && timelineData.timeline.length > 0 && (
        <HistoryTimelineSheet
          timeline={timelineData.timeline}
          trips={timelineData.trips}
          selectedTripId={selectedTripId}
          onSelectTrip={handleSelectTrip}
          onSelectAll={handleSelectAll}
          onSelectStop={handleSelectStop}
        />
      )}

      {/* Nav bar spacer - keeps timeline sheet above the floating nav bar */}
      {allPoints.length > 0 && timelineData.timeline.length > 0 && (
        <View style={styles.navSpacer} />
      )}

      {/* Summary Stats Bottom Strip (only if timeline sheet is not present) */}
      {points.length > 0 && (!allPoints.length || !timelineData.timeline.length) && (
        <View style={styles.statsStrip}>
          <View style={styles.statCol}>
            <Text style={styles.statVal}>{formattedDistance}</Text>
            <Text style={styles.statLbl}>Distance</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statCol}>
            <Text style={styles.statVal}>{maxSpeedKmh} km/h</Text>
            <Text style={styles.statLbl}>Max Speed</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statCol}>
            <Text style={styles.statVal}>{points.length}</Text>
            <Text style={styles.statLbl}>Pointers</Text>
          </View>
        </View>
      )}

      {/* Nav bar spacer for stats strip */}
      {points.length > 0 && (!allPoints.length || !timelineData.timeline.length) && (
        <View style={styles.navSpacer} />
      )}
      <Modal
        visible={pickerModalVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setPickerModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            {/* Header */}
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {pickerTarget === 'from' ? 'Start' : 'End'} Date & Time
              </Text>
              <TouchableOpacity onPress={() => setPickerModalVisible(false)}>
                <Icon name="close" size={22} color={Colors.text.tertiary} />
              </TouchableOpacity>
            </View>

            {/* Month Navigation */}
            <View style={styles.calMonthNav}>
              <TouchableOpacity
                style={styles.calNavBtn}
                onPress={() => setCalendarViewDate(d => subMonths(d, 1))}
              >
                <Icon name="chevron-back" size={18} color={Colors.text.primary} />
              </TouchableOpacity>
              <Text style={styles.calMonthLabel}>
                {format(calendarViewDate, 'MMMM yyyy')}
              </Text>
              <TouchableOpacity
                style={[styles.calNavBtn, calendarViewDate >= startOfMonth(new Date()) && styles.calNavBtnDisabled]}
                onPress={() => {
                  if (calendarViewDate < startOfMonth(new Date())) {
                    setCalendarViewDate(d => addMonths(d, 1));
                  }
                }}
              >
                <Icon
                  name="chevron-forward"
                  size={18}
                  color={calendarViewDate >= startOfMonth(new Date()) ? Colors.text.tertiary : Colors.text.primary}
                />
              </TouchableOpacity>
            </View>

            {/* Day-of-week headers */}
            <View style={styles.calWeekRow}>
              {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
                <Text key={i} style={[styles.calWeekDay, i >= 5 && { color: '#F59E0B' }]}>{d}</Text>
              ))}
            </View>

            {/* Calendar grid - explicit rows to avoid % rounding misalignment */}
            <View style={styles.calGrid}>
              {buildCalendarGrid(calendarViewDate).map((week, rowIdx) => (
                <View key={rowIdx} style={styles.calRow}>
                  {week.map((day, colIdx) => {
                    if (!day) return <View key={colIdx} style={styles.calCell} />;
                    const isSelected = isSameDay(day, tempDate);
                    const isFuture = day > new Date();
                    const isCurrentDay = isToday(day);
                    return (
                      <TouchableOpacity
                        key={colIdx}
                        style={[
                          styles.calCell,
                          isSelected && styles.calCellSelected,
                          isCurrentDay && !isSelected && styles.calCellToday,
                          isFuture && styles.calCellDisabled,
                        ]}
                        onPress={() => {
                          if (isFuture) return;
                          const updated = new Date(tempDate);
                          updated.setFullYear(day.getFullYear(), day.getMonth(), day.getDate());
                          setTempDate(updated);
                        }}
                        activeOpacity={isFuture ? 1 : 0.7}
                      >
                        <Text style={[
                          styles.calCellText,
                          isSelected && styles.calCellTextSelected,
                          isCurrentDay && !isSelected && styles.calCellTextToday,
                          isFuture && styles.calCellTextDisabled,
                        ]}>
                          {day.getDate()}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ))}
            </View>

            {/* Scroll-Wheel Time Picker */}
            <View style={styles.wheelRow}>
              <PickerColumn items={HOUR_ITEMS} selectedIndex={hourIdx} onSelect={applyHour} style={styles.wheelHM} />
              <Text style={styles.wheelColon}>:</Text>
              <PickerColumn items={MIN_ITEMS}  selectedIndex={minIdx}  onSelect={applyMin}  style={styles.wheelHM} />
              <PickerColumn items={AMPM_ITEMS} selectedIndex={ampmIdx} onSelect={applyAmpm} style={styles.wheelAmpm} />
            </View>

            {/* Selected preview */}
            <View style={styles.pickerPreview}>
              <Icon name="calendar-outline" size={14} color={Colors.brand.primary} />
              <Text style={styles.pickerPreviewText}>
                {format(tempDate, 'EEE, MMM d yyyy · h:mm a')}
              </Text>
            </View>

            {/* Actions */}
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setPickerModalVisible(false)}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalDoneBtn} onPress={savePickerValue}>
                <LinearGradient
                  colors={[Colors.brand.primary, '#8B5CF6']}
                  style={styles.modalDoneGrad}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                >
                  <Text style={styles.modalDoneText}>Confirm</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg.primary },
  navSpacer: { height: 72 },

  header: {
    paddingHorizontal: Spacing.xl,
    paddingTop: 42,
    paddingBottom: 6,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontFamily: Fonts.bold,
    fontSize: 20,
    color: Colors.text.primary,
  },
  headerPointCount: {
    backgroundColor: 'rgba(108, 99, 255, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: 'rgba(108, 99, 255, 0.4)',
  },
  headerPointCountText: {
    fontFamily: Fonts.semiBold,
    fontSize: 11,
    color: '#A78BFA',
  },
  headerToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: `${Colors.brand.primary}18`,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: `${Colors.brand.primary}40`,
  },
  headerToggleText: {
    fontFamily: Fonts.semiBold,
    fontSize: 12,
    color: Colors.brand.primary,
  },

  compactRangeBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: Spacing.xl,
    marginBottom: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: Colors.bg.secondary,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.bg.glassBorder,
  },
  compactRangeLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  compactRangeText: {
    fontFamily: Fonts.medium,
    fontSize: 12,
    color: Colors.text.secondary,
  },
  compactRangeEditBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: `${Colors.brand.primary}20`,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radius.sm,
  },
  compactRangeEditText: {
    fontFamily: Fonts.semiBold,
    fontSize: 11,
    color: Colors.brand.primary,
  },

  childSelector: { maxHeight: 46, marginBottom: 8 },
  childTab: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.bg.glassBorder,
    backgroundColor: Colors.bg.secondary,
  },
  childTabText: {
    fontFamily: Fonts.medium,
    fontSize: Fonts.sizes.sm,
    color: Colors.text.secondary,
  },

  // Range Card
  rangeCard: {
    marginHorizontal: Spacing.xl,
    marginBottom: Spacing.md,
    backgroundColor: Colors.bg.secondary,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.bg.glassBorder,
    padding: Spacing.md,
  },
  rangeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  timeBlock: {
    flex: 1,
    backgroundColor: Colors.bg.tertiary,
    borderRadius: Radius.md,
    padding: 10,
    borderWidth: 1,
    borderColor: Colors.bg.glassBorder,
  },
  blockHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 4,
  },
  blockLabel: {
    fontFamily: Fonts.bold,
    fontSize: 10,
    color: Colors.brand.primary,
    letterSpacing: 0.5,
  },
  blockValue: {
    fontFamily: Fonts.semiBold,
    fontSize: Fonts.sizes.sm,
    color: Colors.text.primary,
  },
  arrowWrap: {
    paddingHorizontal: 2,
  },

  presetsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    gap: 6,
  },
  presetChip: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 5,
    borderRadius: Radius.sm,
    backgroundColor: `${Colors.brand.primary}15`,
    borderWidth: 1,
    borderColor: `${Colors.brand.primary}30`,
  },
  presetText: {
    fontFamily: Fonts.medium,
    fontSize: 11,
    color: Colors.brand.primary,
  },

  viewBtn: {
    marginTop: 10,
    borderRadius: Radius.md,
    overflow: 'hidden',
  },
  viewBtnGrad: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 11,
  },
  viewBtnText: {
    fontFamily: Fonts.bold,
    fontSize: Fonts.sizes.sm,
    color: '#fff',
  },
  countBadge: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: Radius.full,
  },
  countBadgeText: {
    fontFamily: Fonts.semiBold,
    fontSize: 11,
    color: '#fff',
  },

  // Map Container
  mapContainer: {
    flex: 1,
    position: 'relative',
  },
  noDataOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: `${Colors.bg.primary}E0`,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
    gap: 8,
  },
  noDataTitle: {
    fontFamily: Fonts.bold,
    fontSize: Fonts.sizes.md,
    color: Colors.text.primary,
  },
  noDataSub: {
    fontFamily: Fonts.regular,
    fontSize: Fonts.sizes.sm,
    color: Colors.text.tertiary,
    textAlign: 'center',
  },

  // Floating HUD on map - compact
  floatingHUD: {
    position: 'absolute',
    bottom: 12,
    left: 12,
    right: 12,
    backgroundColor: `${Colors.bg.secondary}F2`,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.bg.glassBorder,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 8,
  },
  hudHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  hudTimeCol: { flex: 1 },
  hudTimeRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  hudTimeText: {
    fontFamily: Fonts.semiBold,
    fontSize: 12,
    color: Colors.text.primary,
    flex: 1,
  },
  hudSub: {
    fontFamily: Fonts.regular,
    fontSize: 10,
    color: Colors.text.tertiary,
  },
  hudSpeedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: `${Colors.status.online}20`,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: `${Colors.status.online}40`,
  },
  hudSpeedText: {
    fontFamily: Fonts.semiBold,
    fontSize: 11,
    color: Colors.status.online,
  },
  hudSnapBadge: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: `${Colors.text.tertiary}15`,
    paddingHorizontal: 7,
    paddingVertical: 5,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: `${Colors.text.tertiary}30`,
  },
  hudSnapBadgeActive: {
    backgroundColor: 'rgba(0, 229, 255, 0.15)',
    borderColor: 'rgba(0, 229, 255, 0.45)',
  },
  hudSnapText: {
    fontFamily: Fonts.semiBold,
    fontSize: 11,
    color: Colors.text.tertiary,
  },
  hudSnapTextActive: {
    color: '#00E5FF',
  },
  scrubber: {
    width: '100%',
    height: 26,
    marginVertical: 0,
  },
  hudControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.lg,
  },
  hudAuxBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.bg.tertiary,
    borderWidth: 1,
    borderColor: Colors.bg.glassBorder,
  },
  hudPlayBtn: {
    borderRadius: 21,
    overflow: 'hidden',
  },
  hudPlayGrad: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hudSpeedBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: `${Colors.brand.primary}20`,
    borderWidth: 1,
    borderColor: `${Colors.brand.primary}40`,
  },
  hudSpeedBtnText: {
    fontFamily: Fonts.bold,
    fontSize: 12,
    color: Colors.brand.primary,
  },
  hudPtCount: {
    fontFamily: Fonts.regular,
    fontSize: 11,
    color: Colors.text.tertiary,
    minWidth: 40,
    textAlign: 'center',
  },

  // Stats Strip at bottom
  statsStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.bg.secondary,
    borderTopWidth: 1,
    borderTopColor: Colors.bg.glassBorder,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
  },
  statCol: {
    flex: 1,
    alignItems: 'center',
  },
  statVal: {
    fontFamily: Fonts.bold,
    fontSize: Fonts.sizes.sm,
    color: Colors.text.primary,
  },
  statLbl: {
    fontFamily: Fonts.regular,
    fontSize: 10,
    color: Colors.text.tertiary,
  },
  statDivider: {
    width: 1,
    height: 24,
    backgroundColor: Colors.bg.glassBorder,
  },

  // Modal Styles
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    padding: Spacing.xl,
  },
  modalCard: {
    backgroundColor: Colors.bg.secondary,
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.bg.glassBorder,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.md,
  },
  modalTitle: {
    fontFamily: Fonts.bold,
    fontSize: Fonts.sizes.md,
    color: Colors.text.primary,
  },
  sectionLabel: {
    fontFamily: Fonts.semiBold,
    fontSize: Fonts.sizes.xs,
    color: Colors.text.tertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  // Calendar Picker Styles
  calMonthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  calNavBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.bg.tertiary,
    borderWidth: 1,
    borderColor: Colors.bg.glassBorder,
  },
  calNavBtnDisabled: {
    opacity: 0.3,
  },
  calMonthLabel: {
    fontFamily: Fonts.bold,
    fontSize: 15,
    color: Colors.text.primary,
  },
  calWeekRow: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  calWeekDay: {
    flex: 1,
    textAlign: 'center',
    fontFamily: Fonts.semiBold,
    fontSize: 11,
    color: Colors.text.tertiary,
    paddingVertical: 4,
  },
  calGrid: {
    // rows rendered explicitly via calRow
  },
  calRow: {
    flexDirection: 'row',
    marginVertical: 1,
  },
  calCell: {
    flex: 1,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
  },
  calCellSelected: {
    backgroundColor: Colors.brand.primary,
  },
  calCellToday: {
    borderWidth: 1,
    borderColor: Colors.brand.primary,
  },
  calCellDisabled: {
    opacity: 0.2,
  },
  calCellText: {
    fontFamily: Fonts.medium,
    fontSize: 13,
    color: Colors.text.secondary,
  },
  calCellTextSelected: {
    color: '#fff',
    fontFamily: Fonts.bold,
  },
  calCellTextToday: {
    color: Colors.brand.primary,
    fontFamily: Fonts.bold,
  },
  calCellTextDisabled: {
    color: Colors.text.tertiary,
  },

  // Scroll-wheel time picker styles
  wheelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
    backgroundColor: Colors.bg.tertiary,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.bg.glassBorder,
    overflow: 'hidden',
    paddingHorizontal: 8,
  },
  wheelHM: {
    flex: 2,
  },
  wheelAmpm: {
    flex: 1,
  },
  wheelColon: {
    fontSize: 28,
    fontWeight: '700',
    color: Colors.text.tertiary,
    paddingHorizontal: 4,
    marginBottom: 2,
  },

  pickerPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 14,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: `${Colors.brand.primary}15`,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: `${Colors.brand.primary}35`,
  },
  pickerPreviewText: {
    fontFamily: Fonts.semiBold,
    fontSize: 13,
    color: Colors.brand.primary,
  },
  modalActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: Spacing.md,
    marginTop: Spacing.md,
  },
  modalCancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  modalCancelText: {
    fontFamily: Fonts.medium,
    fontSize: Fonts.sizes.sm,
    color: Colors.text.tertiary,
  },
  modalDoneBtn: {
    borderRadius: Radius.md,
    overflow: 'hidden',
  },
  modalDoneGrad: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    alignItems: 'center',
  },
  modalDoneText: {
    fontFamily: Fonts.bold,
    fontSize: Fonts.sizes.sm,
    color: '#fff',
  },
});
