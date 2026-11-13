import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { Ionicons as Icon } from '@expo/vector-icons';
import { format } from 'date-fns';
import { Colors, Fonts, Radius, Spacing } from '../theme/tokens';

function formatDuration(ms) {
  const totalMins = Math.round(ms / 60000);
  if (totalMins < 1) return '< 1 min';
  if (totalMins < 60) return `${totalMins} min${totalMins > 1 ? 's' : ''}`;
  const hrs = Math.floor(totalMins / 60);
  const remMins = totalMins % 60;
  return `${hrs}h ${remMins > 0 ? `${remMins}m` : ''}`.trim();
}

function formatDistance(meters) {
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  return `${(meters / 1000).toFixed(2)} km`;
}

export default function HistoryTimelineSheet({
  timeline = [],
  trips = [],
  selectedTripId = null,
  onSelectTrip,
  onSelectAll,
  onSelectStop,
}) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  if (!timeline || timeline.length === 0) {
    return null;
  }

  const selectedTrip = trips.find((t) => t.id === selectedTripId);

  return (
    <View style={styles.container}>
      {/* Header bar with toggle */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.headerTitleRow}
          onPress={() => setIsCollapsed((prev) => !prev)}
          activeOpacity={0.7}
        >
          <View style={styles.headerBadge}>
            <Icon name="git-commit-outline" size={14} color={Colors.brand.primary} />
            <Text style={styles.headerBadgeText}>
              {trips.length} {trips.length === 1 ? 'Trip' : 'Trips'} Detected
            </Text>
          </View>
          <Icon
            name={isCollapsed ? 'chevron-up-outline' : 'chevron-down-outline'}
            size={18}
            color={Colors.text.secondary}
          />
        </TouchableOpacity>

        {/* All Day filter pill */}
        <TouchableOpacity
          style={[
            styles.allDayBtn,
            selectedTripId === null && styles.allDayBtnActive,
          ]}
          onPress={onSelectAll}
          activeOpacity={0.8}
        >
          <Icon
            name="globe-outline"
            size={12}
            color={selectedTripId === null ? '#fff' : Colors.text.secondary}
          />
          <Text
            style={[
              styles.allDayBtnText,
              selectedTripId === null && styles.allDayBtnTextActive,
            ]}
          >
            All Day
          </Text>
        </TouchableOpacity>
      </View>

      {/* Active Trip Announcement if one is selected */}
      {selectedTrip && (
        <View style={styles.activeBanner}>
          <Text style={styles.activeBannerText} numberOfLines={1}>
            Viewing {selectedTrip.modeEmoji} {selectedTrip.title} (
            {formatDistance(selectedTrip.distanceMeters)}) · Zoomed on route
          </Text>
          <TouchableOpacity
            style={styles.activeResetBtn}
            onPress={onSelectAll}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.activeResetText}>Show All</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Timeline items list */}
      {!isCollapsed && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          {timeline.map((item, idx) => {
            if (item.type === 'trip') {
              const isSelected = selectedTripId === item.id;
              const modeColor =
                item.mode === 'in_vehicle'
                  ? '#3B82F6'
                  : item.mode === 'on_bicycle'
                  ? '#06B6D4'
                  : item.mode === 'running'
                  ? '#F59E0B'
                  : '#10B981';

              return (
                <TouchableOpacity
                  key={item.id || `trip-${idx}`}
                  style={[styles.tripCard, isSelected && styles.tripCardActive]}
                  onPress={() => onSelectTrip(item)}
                  activeOpacity={0.8}
                >
                  <View style={styles.tripCardHeader}>
                    <View
                      style={[
                        styles.modeBadge,
                        { backgroundColor: `${modeColor}25` },
                      ]}
                    >
                      <Icon name={item.modeIcon} size={13} color={modeColor} />
                      <Text style={[styles.modeLabel, { color: modeColor }]}>
                        {item.modeLabel}
                      </Text>
                    </View>
                    <Text style={styles.tripDuration}>
                      {formatDuration(item.durationMs)}
                    </Text>
                  </View>

                  <Text style={styles.tripTimes}>
                    {format(item.startTime, 'h:mm a')} →{' '}
                    {format(item.endTime, 'h:mm a')}
                  </Text>

                  <View style={styles.tripMetrics}>
                    <View style={styles.metricItem}>
                      <Icon
                        name="navigate-outline"
                        size={12}
                        color={Colors.brand.primary}
                      />
                      <Text style={styles.metricValue}>
                        {formatDistance(item.distanceMeters)}
                      </Text>
                    </View>
                    {item.maxSpeedKmh > 0 && (
                      <View style={styles.metricItem}>
                        <Icon
                          name="speedometer-outline"
                          size={12}
                          color={Colors.status.warning}
                        />
                        <Text style={styles.metricValue}>
                          {item.maxSpeedKmh.toFixed(0)} km/h
                        </Text>
                      </View>
                    )}
                  </View>
                </TouchableOpacity>
              );
            }

            // Stop / Stay item
            return (
              <TouchableOpacity
                key={item.id || `stop-${idx}`}
                style={styles.stopCard}
                onPress={() => onSelectStop && onSelectStop(item)}
                activeOpacity={0.8}
              >
                <View style={styles.stopHeader}>
                  <View style={styles.stopPin}>
                    <Icon name="pause-circle" size={13} color="#A78BFA" />
                  </View>
                  <Text style={styles.stopTitle}>Stationary</Text>
                </View>

                <Text style={styles.stopDuration}>
                  {formatDuration(item.durationMs)}
                </Text>

                <Text style={styles.stopTimes}>
                  {format(item.startTime, 'h:mm a')} –{' '}
                  {format(item.endTime, 'h:mm a')}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.bg.secondary,
    borderTopWidth: 1,
    borderTopColor: Colors.bg.glassBorder,
    paddingTop: 8,
    paddingBottom: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    marginBottom: 6,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(108, 99, 255, 0.12)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radius.sm,
  },
  headerBadgeText: {
    fontFamily: Fonts.medium,
    fontSize: 12,
    color: Colors.text.primary,
    fontWeight: '600',
  },
  allDayBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.bg.tertiary,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.bg.glassBorder,
  },
  allDayBtnActive: {
    backgroundColor: Colors.brand.primary,
    borderColor: Colors.brand.primary,
  },
  allDayBtnText: {
    fontFamily: Fonts.medium,
    fontSize: 11,
    color: Colors.text.secondary,
    fontWeight: '600',
  },
  allDayBtnTextActive: {
    color: '#FFFFFF',
  },
  activeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(108, 99, 255, 0.16)',
    borderLeftWidth: 3,
    borderLeftColor: Colors.brand.primary,
    paddingHorizontal: Spacing.md,
    paddingVertical: 4,
    marginBottom: 6,
  },
  activeBannerText: {
    fontFamily: Fonts.medium,
    fontSize: 11,
    color: '#C7D2FE',
    flex: 1,
  },
  activeResetBtn: {
    paddingLeft: 8,
  },
  activeResetText: {
    fontFamily: Fonts.bold,
    fontSize: 11,
    color: '#818CF8',
    textDecorationLine: 'underline',
  },
  scrollContent: {
    paddingHorizontal: Spacing.md,
    gap: 8,
    paddingBottom: 2,
  },
  tripCard: {
    backgroundColor: Colors.bg.tertiary,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: Colors.bg.glassBorder,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minWidth: 160,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 2,
  },
  tripCardActive: {
    borderColor: Colors.brand.primary,
    backgroundColor: 'rgba(108, 99, 255, 0.20)',
  },
  tripCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  modeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: Radius.xs,
  },
  modeLabel: {
    fontFamily: Fonts.medium,
    fontSize: 10,
    fontWeight: '700',
  },
  tripDuration: {
    fontFamily: Fonts.regular,
    fontSize: 10,
    color: Colors.text.tertiary,
  },
  tripTimes: {
    fontFamily: Fonts.bold,
    fontSize: 12,
    color: Colors.text.primary,
    marginBottom: 6,
  },
  tripMetrics: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  metricItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  metricValue: {
    fontFamily: Fonts.medium,
    fontSize: 11,
    color: Colors.text.secondary,
    fontWeight: '600',
  },
  stopCard: {
    backgroundColor: 'rgba(31, 41, 55, 0.45)',
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
    borderStyle: 'dashed',
    paddingHorizontal: 10,
    paddingVertical: 8,
    minWidth: 130,
    justifyContent: 'center',
  },
  stopHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 2,
  },
  stopPin: {
    width: 14,
    height: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopTitle: {
    fontFamily: Fonts.medium,
    fontSize: 10,
    color: '#A78BFA',
    fontWeight: '600',
  },
  stopDuration: {
    fontFamily: Fonts.bold,
    fontSize: 12,
    color: Colors.text.primary,
    marginBottom: 2,
  },
  stopTimes: {
    fontFamily: Fonts.regular,
    fontSize: 10,
    color: Colors.text.tertiary,
  },
});
