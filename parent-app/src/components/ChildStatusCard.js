import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Animated, Image, Alert, ActivityIndicator, Modal,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons as Icon } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';
import * as ImagePicker from 'expo-image-picker';
import ColorsDefault, { Colors as ColorsNamed, Fonts as FontsNamed } from '../theme/tokens';
import { format, isToday } from 'date-fns';
import { childAPI } from '../services/api';
import ChildPinResetModal from './ChildPinResetModal';
import SnapshotModal from './SnapshotModal';
import CallLogModal from './CallLogModal';

const Fonts = FontsNamed || {};

/**
 * ChildStatusCard
 * Matches the exact design in media_1790076285419.png:
 * - Large dashed circle avatar with camera & radiant decorative sparks
 * - Name, Online status, and Location packed compactly beside avatar
 * - Neon green battery with yellow lightning bolt & white percentage
 * - High-contrast dark telemetry strip with cyan speed, stationary, and clock
 * - Vibrant violet-to-indigo "Live map >" gradient pill
 * - History, Reset PIN (green border/bg), and Delete (crimson border/bg) action buttons
 */
export default function ChildStatusCard({ child, status, onViewMap, onViewHistory, onPairDevice, onDelete, onAvatarUpdated }) {
  const slideAnim = useRef(new Animated.Value(20)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const isPaired = Boolean(child.device_id);
  const [address, setAddress] = useState(isPaired ? 'Fetching location...' : 'No device paired yet');
  const [uploading, setUploading] = useState(false);
  const [localAvatar, setLocalAvatar] = useState(null);
  const [pinModalVisible, setPinModalVisible] = useState(false);
  const [snapshotModalVisible, setSnapshotModalVisible] = useState(false);
  const [callLogModalVisible, setCallLogModalVisible] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const lastAddrFetch = useRef(null);

  const pickImage = async (type) => {
    try {
      const options = {
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
        base64: true,
      };

      const result = type === 'camera'
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);

      if (result.canceled || !result.assets || result.assets.length === 0) return;

      const asset = result.assets[0];
      if (!asset.base64) {
        Alert.alert('Upload Error', 'Could not read image data.');
        return;
      }

      const mimeType = asset.mimeType || 'image/jpeg';
      const dataUri = `data:${mimeType};base64,${asset.base64}`;

      setUploading(true);
      await childAPI.updateAvatar(child.id, dataUri);
      setLocalAvatar(dataUri);
      if (onAvatarUpdated) {
        onAvatarUpdated(child.id, dataUri);
      }
    } catch (err) {
      console.error('Failed to upload child avatar:', err);
      const serverMsg = err.response?.data?.error || err.response?.data?.message || err.message;
      Alert.alert('Upload Error', serverMsg ? `${serverMsg}` : 'Failed to update child profile image. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const handleAvatarPress = () => {
    Alert.alert(
      `${child.name}'s Photo`,
      'Choose a photo to display on the live map and dashboard:',
      [
        { text: 'Choose from Gallery', onPress: () => pickImage('gallery') },
        { text: 'Take Photo', onPress: () => pickImage('camera') },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  };

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 400, useNativeDriver: true }),
    ]).start();
  }, []);

  // Reverse geocode via Nominatim
  useEffect(() => {
    if (!isPaired || !status?.lat || !status?.lng) return;
    const now = Date.now();
    if (lastAddrFetch.current && now - lastAddrFetch.current < 30000) return;
    lastAddrFetch.current = now;

    fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${status.lat}&lon=${status.lng}&format=json`,
      { headers: { 'User-Agent': 'CareTrackApp/1.0' } },
    )
      .then((r) => r.json())
      .then((d) => {
        const addr = d.address;
        const parts = [
          addr?.road,
          addr?.suburb || addr?.neighbourhood,
          addr?.city || addr?.town || addr?.village,
        ].filter(Boolean);
        setAddress(parts.join(', ') || d.display_name?.split(',').slice(0, 2).join(',') || 'Unknown location');
      })
      .catch(() => setAddress('Location unavailable'));
  }, [isPaired, status?.lat, status?.lng]);

  const locAgeMs = status?.recordedAt ? Math.abs(Date.now() - new Date(status.recordedAt).getTime()) : 0;
  const isStale = locAgeMs > 45000;

  const hasSpeed = status?.speed !== undefined && status?.speed !== null;
  const rawSpeed = isStale ? 0 : (hasSpeed ? Number(status.speed) * 3.6 : 0);
  const speedVal = status?.isOnline ? rawSpeed : null;
  const speedKmh = speedVal !== null ? (speedVal >= 1.5 ? speedVal.toFixed(1) : '0.0') : '0.0';

  const battery = status?.batteryLevel ?? null;
  const isCharging = Boolean(status?.isCharging);
  const battColor = battery === null ? '#94A3B8'
    : battery > 50 ? '#22C55E'
    : battery > 20 ? '#F59E0B' : '#EF4444';

  const battIcon = isCharging
    ? 'battery-charging'
    : (battery === null || battery > 75)
    ? 'battery-full'
    : battery > 30
    ? 'battery-half'
    : 'battery-dead';

  // Format date and time for telemetry pill
  const getTimeParts = (ts) => {
    if (!ts) {
      const now = new Date();
      return { dateStr: 'Today', timeStr: format(now, 'hh:mm:ss a') };
    }
    try {
      const d = new Date(ts);
      if (isNaN(d.getTime())) {
        const now = new Date();
        return { dateStr: 'Today', timeStr: format(now, 'hh:mm:ss a') };
      }
      const dateStr = isToday(d) ? 'Today' : format(d, 'MMM d');
      const timeStr = format(d, 'hh:mm:ss a');
      return { dateStr, timeStr };
    } catch {
      return { dateStr: 'Today', timeStr: '--:--:--' };
    }
  };

  const timeParts = getTimeParts(status?.recordedAt || status?.lastSeen);

  // Activity recognition
  let activity = status?.activityType;
  if (isStale || !speedVal || speedVal < 1.0) {
    activity = 'still';
  } else if (activity === 'running' && speedVal < 7.0) {
    activity = 'walking';
  } else if (activity == null) {
    if (speedVal >= 15.0) activity = 'in_vehicle';
    else if (speedVal >= 5.0) activity = 'on_bicycle';
    else if (speedVal >= 2.0) activity = 'walking';
    else activity = 'still';
  }

  const activityConfig = {
    walking:    { icon: 'walk-outline',    label: 'Walking',    color: '#10B981' },
    running:    { icon: 'fitness-outline', label: 'Running',    color: '#F59E0B' },
    in_vehicle: { icon: 'car-outline',     label: 'In Vehicle', color: '#3B82F6' },
    on_bicycle: { icon: 'bicycle-outline', label: 'Cycling',    color: '#06B6D4' },
    still:      { icon: 'pause',           label: 'Stationary', color: '#818CF8' },
    unknown:    { icon: 'pause',           label: 'Stationary', color: '#818CF8' },
  };
  const actCfg = activityConfig[activity] || activityConfig.still;

  const initials = child.name ? child.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase() : '?';
  const hasAvatar = Boolean(localAvatar || child.avatar_url);

  return (
    <Animated.View
      style={[
        styles.card,
        { opacity: fadeAnim, transform: [{ translateY: slideAnim }] },
      ]}
    >
      {/* 1. Header Row (Avatar + Child Info + Battery) */}
      <View style={styles.headerRow}>
        {/* Avatar with dashed circular border and radiant sparks */}
        <View style={styles.avatarWrapper}>
          {/* 3 Radiant Decorative Sparks on top-left of circle */}
          <View style={styles.sparksContainer}>
            <View style={[styles.sparkRay, styles.sparkRay1]} />
            <View style={[styles.sparkRay, styles.sparkRay2]} />
            <View style={[styles.sparkRay, styles.sparkRay3]} />
          </View>

          <TouchableOpacity
            style={[styles.avatar, hasAvatar && styles.avatarWithPhoto]}
            onPress={handleAvatarPress}
            activeOpacity={0.8}
          >
            {uploading ? (
              <ActivityIndicator size="small" color="#818CF8" />
            ) : hasAvatar ? (
              <>
                <Image
                  source={{ uri: localAvatar || child.avatar_url }}
                  style={styles.avatarImage}
                  resizeMode="cover"
                />
                <View style={styles.cameraBadge}>
                  <Icon name="camera" size={10} color="#FFFFFF" />
                </View>
              </>
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Icon name="camera-outline" size={24} color="#FFFFFF" />
                <Text style={styles.avatarPlaceholderText}>Tap to upload photo</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        {/* Child Name, Online Status & Location tightly grouped */}
        <View style={styles.childInfo}>
          <Text style={styles.childName} numberOfLines={1}>{child.name}</Text>

          <View style={styles.statusRow}>
            <View style={[
              styles.statusDot,
              {
                backgroundColor: !isPaired
                  ? '#F59E0B'
                  : status?.isOnline
                  ? '#22C55E'
                  : '#64748B',
              },
            ]} />
            <Text style={[
              styles.statusText,
              {
                color: !isPaired
                  ? '#F59E0B'
                  : status?.isOnline
                  ? '#22C55E'
                  : '#94A3B8',
              },
            ]}>
              {!isPaired ? 'Not Paired' : status?.isOnline ? 'Online' : 'Offline'}
            </Text>
          </View>

          <View style={styles.addressRow}>
            <Icon name="location-sharp" size={14} color="#94A3B8" />
            <Text style={styles.addressText} numberOfLines={1}>
              {isPaired ? address : 'Pair device to start tracking'}
            </Text>
          </View>
        </View>

        {/* Battery Indicator & 3-Dots Menu on far right */}
        <View style={styles.headerRightArea}>
          {isPaired && (
            <View style={styles.batteryArea}>
              <View style={styles.batteryIconRow}>
                <Icon name={battIcon} size={24} color={battColor} />
                {isCharging && (
                  <Icon name="flash" size={14} color="#FBBF24" style={styles.chargingBolt} />
                )}
              </View>
              {battery !== null ? (
                <Text style={styles.batteryPercentText}>{battery}%</Text>
              ) : (
                <Text style={[styles.batteryPercentText, { color: '#64748B' }]}>--%</Text>
              )}
            </View>
          )}

          <TouchableOpacity
            style={styles.moreMenuBtn}
            onPress={() => setMenuVisible(true)}
            activeOpacity={0.7}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Icon name="ellipsis-vertical" size={18} color="#94A3B8" />
          </TouchableOpacity>
        </View>
      </View>

      {/* 2. Telemetry Strip (Speed | Stationary | Time) */}
      {isPaired ? (
        <View style={styles.telemetryBar}>
          {/* Speed */}
          <View style={styles.telemetryItem}>
            <Icon name="speedometer-outline" size={18} color="#00E5FF" />
            <Text style={styles.speedText}>{speedKmh} km/h</Text>
          </View>

          {/* Dot separator */}
          <View style={styles.telemetryDot} />

          {/* Activity */}
          <View style={styles.telemetryItem}>
            <Icon name={actCfg.icon} size={16} color="#818CF8" />
            <Text style={styles.activityText}>{actCfg.label}</Text>
          </View>

          {/* Dot separator */}
          <View style={styles.telemetryDot} />

          {/* Time / Last Seen */}
          <View style={styles.telemetryItem}>
            <Icon name="time-outline" size={16} color="#94A3B8" />
            <View style={styles.timeCol}>
              <Text style={styles.timeDateText}>{timeParts.dateStr}</Text>
              <Text style={styles.timeClockText}>{timeParts.timeStr}</Text>
            </View>
          </View>
        </View>
      ) : (
        <View style={styles.telemetryBar}>
          <View style={styles.telemetryItem}>
            <Icon name="link-outline" size={16} color="#F59E0B" />
            <Text style={[styles.activityText, { color: '#F59E0B' }]}>No active device paired</Text>
          </View>
        </View>
      )}

      {/* 3. Action Buttons */}
      <View style={styles.actionsContainer}>
        {isPaired ? (
          <>
            {/* Full-width "Live map" button with vibrant gradient and location trail (Matching Image 1) */}
            <TouchableOpacity
              style={styles.liveMapBtn}
              onPress={onViewMap}
              activeOpacity={0.88}
            >
              <LinearGradient
                colors={['#4F75FF', '#5A6BF8', '#6A5CF6', '#8052F7', '#9742F5', '#A338F3']}
                style={styles.liveMapBtnGrad}
                start={{ x: 0, y: 0.2 }}
                end={{ x: 1, y: 0.8 }}
              >
                {/* Decorative left curved dashed trail & soft wave highlight matching user image */}
                <Svg
                  width={110}
                  height={56}
                  viewBox="0 0 110 56"
                  style={styles.liveMapLeftTrailSvg}
                  pointerEvents="none"
                >
                  <Path
                    d="M 0 0 L 90 0 C 72 20, 42 32, 0 38 Z"
                    fill="rgba(255, 255, 255, 0.09)"
                  />
                  <Path
                    d="M 10 32 C 26 44, 50 42, 68 33 C 82 26, 92 18, 104 12"
                    stroke="rgba(255, 255, 255, 0.42)"
                    strokeWidth="2.5"
                    strokeDasharray="6, 7"
                    strokeLinecap="round"
                    fill="none"
                  />
                </Svg>

                {/* Centered Map Icon + Live Map Text */}
                <View style={styles.liveMapCenterRow} pointerEvents="none">
                  <Icon name="map-outline" size={23} color="#FFFFFF" />
                  <Text style={styles.liveMapBtnText}>Live map</Text>
                </View>

                {/* Right Cluster: Wave trail curving up to Location Pin + Chevron Pill */}
                <View style={styles.liveMapRightCluster} pointerEvents="none">
                  <View style={styles.liveMapWavePinContainer}>
                    <Svg
                      width={44}
                      height={56}
                      viewBox="0 0 44 56"
                      style={styles.liveMapWaveSvg}
                    >
                      <Path
                        d="M 2 44 C 10 40, 20 28, 42 28"
                        stroke="rgba(255, 255, 255, 0.65)"
                        strokeWidth="2.5"
                        strokeDasharray="5, 6"
                        strokeLinecap="round"
                        fill="none"
                      />
                    </Svg>
                    <View style={styles.liveMapPinWrapper}>
                      <Icon name="location-sharp" size={24} color="#BFDBFE" />
                    </View>
                  </View>
                  <View style={styles.chevronPill}>
                    <Icon name="chevron-forward" size={17} color="#FFFFFF" />
                  </View>
                </View>
              </LinearGradient>
            </TouchableOpacity>

            {/* Action buttons: 3 buttons only in bottom row (History | Call Logs | Snapshot) */}
            <View style={styles.bottomButtonsRow}>
              {/* History Button */}
              <TouchableOpacity
                style={styles.actionCardHistory}
                onPress={onViewHistory}
                activeOpacity={0.8}
              >
                <Icon name="time-outline" size={22} color="#38BDF8" style={styles.actionCardIcon} />
                <View style={styles.actionCardTextCol}>
                  <Text style={styles.actionCardTitle} numberOfLines={1}>History</Text>
                  <Text style={styles.actionCardSubtitle} numberOfLines={1}>Activity</Text>
                </View>
              </TouchableOpacity>

              {/* Call Logs Button */}
              <TouchableOpacity
                style={styles.actionCardCalls}
                onPress={() => setCallLogModalVisible(true)}
                activeOpacity={0.8}
              >
                <Icon name="call-outline" size={22} color="#00E5FF" style={styles.actionCardIcon} />
                <View style={styles.actionCardTextCol}>
                  <Text style={[styles.actionCardTitle, { color: '#E0F2FE' }]} numberOfLines={1}>Call Logs</Text>
                  <Text style={[styles.actionCardSubtitle, { color: '#38BDF8' }]} numberOfLines={1}>Telephony</Text>
                </View>
              </TouchableOpacity>

              {/* Snapshot Button */}
              <TouchableOpacity
                style={styles.actionCardSnapshot}
                onPress={() => setSnapshotModalVisible(true)}
                activeOpacity={0.8}
              >
                <Icon name="radio-outline" size={22} color="#A855F7" style={styles.actionCardIcon} />
                <View style={styles.actionCardTextCol}>
                  <Text style={[styles.actionCardTitle, { color: '#E9D5FF' }]} numberOfLines={1}>Snapshot</Text>
                  <Text style={[styles.actionCardSubtitle, { color: '#C084FC' }]} numberOfLines={1}>Surround</Text>
                </View>
              </TouchableOpacity>
            </View>
          </>
        ) : (
          <>
            <TouchableOpacity
              style={styles.liveMapBtn}
              onPress={onPairDevice}
              activeOpacity={0.85}
            >
              <LinearGradient
                colors={['#7C3AED', '#6366F1']}
                style={styles.liveMapBtnGrad}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
              >
                <Icon name="qr-code-outline" size={18} color="#FFFFFF" />
                <Text style={styles.liveMapBtnText}>Pair Device</Text>
                <Icon name="chevron-forward" size={16} color="#FFFFFF" />
              </LinearGradient>
            </TouchableOpacity>

            {onDelete && (
              <View style={styles.bottomButtonsRow}>
                <TouchableOpacity
                  style={[styles.bottomBtnDelete, { flex: 1 }]}
                  onPress={onDelete}
                  activeOpacity={0.8}
                >
                  <Icon name="trash-outline" size={18} color="#EF4444" />
                  <Text style={styles.bottomBtnDeleteText}>Delete Child</Text>
                </TouchableOpacity>
              </View>
            )}
          </>
        )}
      </View>

      {/* Child PIN Reset Modal */}
      {isPaired && (
        <ChildPinResetModal
          visible={pinModalVisible}
          child={child}
          onClose={() => setPinModalVisible(false)}
        />
      )}

      {/* Safety Snapshot Modal (Audio / Surroundings Check-in) */}
      {isPaired && (
        <SnapshotModal
          visible={snapshotModalVisible}
          child={child}
          onClose={() => setSnapshotModalVisible(false)}
        />
      )}

      {/* Call Log Modal (Telephony Tracker) */}
      {isPaired && (
        <CallLogModal
          visible={callLogModalVisible}
          child={child}
          onClose={() => setCallLogModalVisible(false)}
        />
      )}

      {/* 3-Dots Action Menu Modal */}
      <Modal
        visible={menuVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuVisible(false)}
      >
        <TouchableOpacity
          style={styles.menuBackdrop}
          activeOpacity={1}
          onPress={() => setMenuVisible(false)}
        >
          <View style={styles.menuContainer}>
            <View style={styles.menuHeader}>
              <Text style={styles.menuHeaderTitle}>{child.name}</Text>
              <Text style={styles.menuHeaderSubtitle}>Device & Profile Options</Text>
            </View>

            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                setMenuVisible(false);
                handleAvatarPress();
              }}
              activeOpacity={0.7}
            >
              <View style={[styles.menuItemIconWrap, { backgroundColor: 'rgba(129, 140, 248, 0.15)' }]}>
                <Icon name="camera-outline" size={18} color="#818CF8" />
              </View>
              <Text style={styles.menuItemText}>Change Profile Photo</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                setMenuVisible(false);
                setCallLogModalVisible(true);
              }}
              activeOpacity={0.7}
            >
              <View style={[styles.menuItemIconWrap, { backgroundColor: 'rgba(0, 229, 255, 0.15)' }]}>
                <Icon name="call-outline" size={18} color="#00E5FF" />
              </View>
              <Text style={styles.menuItemText}>View Call Logs</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                setMenuVisible(false);
                setPinModalVisible(true);
              }}
              activeOpacity={0.7}
            >
              <View style={[styles.menuItemIconWrap, { backgroundColor: 'rgba(16, 185, 129, 0.15)' }]}>
                <Icon name="shield-outline" size={18} color="#10B981" />
              </View>
              <Text style={styles.menuItemText}>Reset Tamper PIN</Text>
            </TouchableOpacity>

            {onDelete && (
              <TouchableOpacity
                style={[styles.menuItem, styles.menuItemBorderTop]}
                onPress={() => {
                  setMenuVisible(false);
                  onDelete(child);
                }}
                activeOpacity={0.7}
              >
                <View style={[styles.menuItemIconWrap, { backgroundColor: 'rgba(239, 68, 68, 0.15)' }]}>
                  <Icon name="trash-outline" size={18} color="#EF4444" />
                </View>
                <Text style={[styles.menuItemText, { color: '#EF4444' }]}>Delete Device</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={styles.menuCancelBtn}
              onPress={() => setMenuVisible(false)}
              activeOpacity={0.8}
            >
              <Text style={styles.menuCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#0E1528',
    borderRadius: 24,
    borderWidth: 1.4,
    borderColor: 'rgba(59, 130, 246, 0.32)',
    paddingHorizontal: 12,
    paddingVertical: 18,
    marginBottom: 18,
    shadowColor: '#3B82F6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.22,
    shadowRadius: 16,
    elevation: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  avatarWrapper: {
    position: 'relative',
    marginRight: 14,
  },
  sparksContainer: {
    position: 'absolute',
    top: -5,
    left: -3,
    width: 20,
    height: 20,
    zIndex: 3,
  },
  sparkRay: {
    position: 'absolute',
    borderRadius: 1.5,
  },
  sparkRay1: {
    width: 2.5,
    height: 7,
    backgroundColor: '#C084FC',
    top: 6,
    left: 0,
    transform: [{ rotate: '-65deg' }],
  },
  sparkRay2: {
    width: 2.5,
    height: 8,
    backgroundColor: '#FBBF24',
    top: 2,
    left: 5,
    transform: [{ rotate: '-40deg' }],
  },
  sparkRay3: {
    width: 2.5,
    height: 8,
    backgroundColor: '#F59E0B',
    top: 0,
    left: 12,
    transform: [{ rotate: '-18deg' }],
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(15, 23, 42, 0.7)',
    borderWidth: 1.5,
    borderColor: '#3B82F6',
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarWithPhoto: {
    borderStyle: 'solid',
    borderColor: '#4F46E5',
  },
  avatarPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  avatarPlaceholderText: {
    fontFamily: Fonts?.medium || 'sans-serif-medium',
    fontSize: 9.5,
    color: '#94A3B8',
    textAlign: 'center',
    lineHeight: 12,
    marginTop: 4,
    maxWidth: 64,
  },
  avatarImage: {
    width: '100%',
    height: '100%',
    borderRadius: 38,
  },
  cameraBadge: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    backgroundColor: '#7C3AED',
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#0B1122',
  },
  childInfo: {
    flex: 1,
    justifyContent: 'center',
  },
  childName: {
    fontFamily: Fonts?.bold || 'sans-serif-bold',
    fontSize: 24,
    color: '#FFFFFF',
    letterSpacing: -0.3,
    marginBottom: 3,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  statusDot: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
  },
  statusText: {
    fontFamily: Fonts?.bold || 'sans-serif-bold',
    fontSize: 14,
  },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  addressText: {
    fontFamily: Fonts?.medium || 'sans-serif-medium',
    fontSize: 12.5,
    color: '#94A3B8',
    flex: 1,
  },
  batteryArea: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingLeft: 6,
  },
  batteryIconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  chargingBolt: {
    marginLeft: 1,
  },
  batteryPercentText: {
    fontFamily: Fonts?.bold || 'sans-serif-bold',
    fontSize: 16,
    color: '#FFFFFF',
    textAlign: 'right',
    marginTop: 2,
  },
  telemetryBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#090F1E',
    borderRadius: 16,
    borderWidth: 1.2,
    borderColor: '#182544',
    height: 52,
    paddingHorizontal: 16,
    marginTop: 14,
    marginBottom: 14,
  },
  telemetryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  telemetryDot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: '#334155',
  },
  speedText: {
    fontFamily: Fonts?.bold || 'sans-serif-bold',
    fontSize: 13,
    color: '#00E5FF',
  },
  activityText: {
    fontFamily: Fonts?.bold || 'sans-serif-bold',
    fontSize: 13,
    color: '#FFFFFF',
  },
  timeCol: {
    alignItems: 'flex-start',
  },
  timeDateText: {
    fontFamily: Fonts?.medium || 'sans-serif-medium',
    fontSize: 9.5,
    color: '#94A3B8',
    lineHeight: 12,
  },
  timeClockText: {
    fontFamily: Fonts?.bold || 'sans-serif-bold',
    fontSize: 12,
    color: '#FFFFFF',
    lineHeight: 14,
  },
  actionsContainer: {
    gap: 10,
  },
  liveMapBtn: {
    width: '100%',
    height: 56,
    borderRadius: 28,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    shadowColor: '#6366F1',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 12,
    elevation: 6,
  },
  liveMapBtnGrad: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    paddingHorizontal: 8,
  },
  liveMapLeftTrailSvg: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
  },
  liveMapCenterRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    zIndex: 2,
  },
  liveMapBtnText: {
    fontFamily: Fonts?.bold || 'sans-serif-bold',
    fontSize: 17,
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },
  liveMapRightCluster: {
    position: 'absolute',
    right: 8,
    top: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    zIndex: 3,
  },
  liveMapWavePinContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    height: 56,
  },
  liveMapWaveSvg: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
  },
  liveMapPinWrapper: {
    marginLeft: 39,
    marginTop: 7,
  },
  chevronPill: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0.8,
    borderColor: 'rgba(255, 255, 255, 0.18)',
  },
  bottomButtonsRow: {
    flexDirection: 'row',
    gap: 5,
  },
  actionCardHistory: {
    flex: 1,
    minHeight: 52,
    borderRadius: 14,
    backgroundColor: '#091326',
    borderWidth: 1.2,
    borderColor: 'rgba(56, 189, 248, 0.35)',
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 7,
    paddingLeft: 6,
    paddingRight: 4,
    gap: 4,
  },
  actionCardPin: {
    flex: 1,
    minHeight: 52,
    borderRadius: 14,
    backgroundColor: '#041B16',
    borderWidth: 1.2,
    borderColor: 'rgba(16, 185, 129, 0.35)',
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 7,
    paddingLeft: 6,
    paddingRight: 4,
    gap: 4,
  },
  actionCardSnapshot: {
    flex: 1,
    minHeight: 52,
    borderRadius: 14,
    backgroundColor: '#1E1035',
    borderWidth: 1.2,
    borderColor: 'rgba(168, 85, 247, 0.45)',
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 7,
    paddingLeft: 6,
    paddingRight: 4,
    gap: 4,
  },
  actionCardCalls: {
    flex: 1,
    minHeight: 52,
    borderRadius: 14,
    backgroundColor: '#041B26',
    borderWidth: 1.2,
    borderColor: 'rgba(6, 182, 212, 0.35)',
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 7,
    paddingLeft: 6,
    paddingRight: 4,
    gap: 4,
  },
  headerRightArea: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 4,
  },
  moreMenuBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  menuContainer: {
    width: '100%',
    maxWidth: 320,
    backgroundColor: '#0F172A',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#1E293B',
    padding: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 10,
  },
  menuHeader: {
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
    paddingBottom: 12,
    marginBottom: 8,
  },
  menuHeaderTitle: {
    fontFamily: Fonts?.bold || 'sans-serif-bold',
    fontSize: 16,
    color: '#FFFFFF',
  },
  menuHeaderSubtitle: {
    fontFamily: Fonts?.regular || 'sans-serif',
    fontSize: 12,
    color: '#94A3B8',
    marginTop: 2,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 12,
  },
  menuItemBorderTop: {
    borderTopWidth: 1,
    borderTopColor: '#1E293B',
    marginTop: 4,
  },
  menuItemIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuItemText: {
    fontFamily: Fonts?.medium || 'sans-serif-medium',
    fontSize: 14,
    color: '#F1F5F9',
  },
  menuCancelBtn: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    paddingVertical: 11,
    alignItems: 'center',
    marginTop: 12,
  },
  menuCancelText: {
    fontFamily: Fonts?.medium || 'sans-serif-medium',
    fontSize: 13.5,
    color: '#94A3B8',
  },
  actionCardIcon: {
    marginRight: 0,
  },
  actionCardTextCol: {
    flex: 1,
    justifyContent: 'center',
  },
  actionCardTitle: {
    fontFamily: Fonts?.bold || 'sans-serif-bold',
    fontSize: 11.8,
    color: '#FFFFFF',
    lineHeight: 14.5,
    letterSpacing: -0.2,
  },
  actionCardSubtitle: {
    fontFamily: Fonts?.medium || 'sans-serif-medium',
    fontSize: 8.5,
    color: '#94A3B8',
    marginTop: 1.5,
    lineHeight: 10.5,
    letterSpacing: -0.2,
  },
  deleteHeaderBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
  },
});
