import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  RefreshControl, Animated, ActivityIndicator, Dimensions, Alert, Image, StatusBar, FlatList, Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons as Icon } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { format } from 'date-fns';
import { Colors, Fonts, Spacing, Radius } from '../../theme/tokens';
import { childAPI } from '../../services/api';
import { onLocationUpdate, onChildStatus, offLocationUpdate, offChildStatus, disconnectSocket, connectSocket } from '../../services/socket';
import ChildStatusCard from '../../components/ChildStatusCard';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_WIDTH = SCREEN_WIDTH - 32;

export default function DashboardScreen({ navigation, onLogout }) {
  const [children, setChildren] = useState([]);
  const [childStatuses, setChildStatuses] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [parentName, setParentName] = useState('');
  const [activeChildIndex, setActiveChildIndex] = useState(0);
  const flatListRef = useRef(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    AsyncStorage.getItem('parentName').then((n) => setParentName(n || 'Parent'));
  }, []);

  useEffect(() => {
    if (activeChildIndex >= children.length && children.length > 0) {
      setActiveChildIndex(children.length - 1);
    }
  }, [children.length, activeChildIndex]);

  useFocusEffect(
    useCallback(() => {
      loadChildren();
      // Refresh every 2 minutes while screen is focused to keep battery level in sync
      const refreshInterval = setInterval(() => loadChildren(), 2 * 60 * 1000);
      return () => clearInterval(refreshInterval);
    }, []),
  );

  useEffect(() => {
    const handleLocationUpdate = (data) => {
      setChildStatuses((prev) => ({
        ...prev,
        [data.childId]: {
          ...prev[data.childId],
          lat: data.lat,
          lng: data.lng,
          speed: data.speed,
          heading: data.heading,
          batteryLevel: data.batteryLevel != null ? data.batteryLevel : prev[data.childId]?.batteryLevel,
          isCharging: data.isCharging ?? prev[data.childId]?.isCharging,
          lastSeen: data.recordedAt ?? data.timestamp,
          recordedAt: data.recordedAt,
          activityType: data.activityType ?? prev[data.childId]?.activityType,
          isOnline: true,
        },
      }));
    };

    const handleChildStatus = (data) => {
      setChildStatuses((prev) => {
        const existing = prev[data.childId];
        return {
          ...prev,
          [data.childId]: {
            ...existing,
            isOnline: data.isOnline ?? existing?.isOnline,
            lastSeen: data.lastSeen ?? existing?.lastSeen,
            batteryLevel: data.batteryLevel ?? existing?.batteryLevel,
            isCharging: data.isCharging ?? existing?.isCharging,
            speed: (data.speed !== undefined && data.speed !== null)
              ? Number(data.speed)
              : existing?.speed,
            activityType: data.activityType ?? existing?.activityType,
          },
        };
      });
    };

    onLocationUpdate(handleLocationUpdate);
    onChildStatus(handleChildStatus);
    return () => {
      offLocationUpdate(handleLocationUpdate);
      offChildStatus(handleChildStatus);
    };
  }, []);

  const loadChildren = async () => {
    try {
      const { data } = await childAPI.list();
      setChildren(data?.children || []);
      const statuses = {};
      for (const child of data.children) {
        if (child.lastLocation) {
          statuses[child.id] = {
            lat: child.lastLocation.lat,
            lng: child.lastLocation.lng,
            speed: child.lastLocation.speed != null ? child.lastLocation.speed : (child.isOnline ? 0 : null),
            batteryLevel: child.lastLocation.battery_level ?? child.device_battery_level ?? null,
            isCharging: child.lastLocation.is_charging ?? child.device_is_charging ?? false,
            lastSeen: child.lastLocation.recorded_at || child.last_seen,
            recordedAt: child.lastLocation.recorded_at || null,
            isOnline: Boolean(child.isOnline),
          };
        } else if (child.device_id) {
          statuses[child.id] = {
            isOnline: Boolean(child.isOnline),
            lastSeen: child.last_seen,
            speed: child.isOnline ? 0 : null,
            batteryLevel: child.device_battery_level ?? null,
            isCharging: child.device_is_charging ?? false,
          };
        }
      }
      setChildStatuses(statuses);
    } catch (err) {
      console.error('Failed to load children:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
      Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }).start();
    }
  };

  const handleDeleteChild = (child) => {
    Alert.alert(
      'Remove Child Profile',
      `Are you sure you want to remove "${child.name}"? This will delete the profile and associated device history.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await childAPI.delete(child.id);
              loadChildren();
            } catch (err) {
              Alert.alert('Error', 'Failed to remove child profile');
            }
          },
        },
      ],
    );
  };

  const handleLogout = async () => {
    await AsyncStorage.multiRemove(['accessToken', 'refreshToken', 'parentId', 'parentName', 'parentEmail']);
    onLogout();
  };

  // Weather and greeting text according to time of day
  const getGreetingHeader = () => {
    const h = new Date().getHours();
    let text = 'Good Morning';
    let icon = 'sunny';
    let color = '#F59E0B';

    if (h >= 5 && h < 12) {
      text = 'Good Morning';
      icon = 'sunny';
      color = '#F59E0B';
    } else if (h >= 12 && h < 17) {
      text = 'Good Afternoon';
      icon = 'sunny';
      color = '#FBBF24';
    } else if (h >= 17 && h < 21) {
      text = 'Good Evening';
      icon = 'partly-sunny';
      color = '#F59E0B';
    } else {
      text = 'Good Night';
      icon = 'moon';
      color = '#818CF8';
    }
    const dateStr = format(new Date(), 'EEE, d MMM'); // e.g. "Tue, 22 Sep"
    return { text, dateStr, icon, color };
  };
  const greeting = getGreetingHeader();

  const parentInitials = parentName
    ? parentName.trim().split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()
    : 'P';

  const onlineCount = Object.values(childStatuses).filter((s) => s.isOnline).length;

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <LinearGradient colors={['#0A0E1A', '#111827']} style={StyleSheet.absoluteFill} />
        <ActivityIndicator size="large" color={Colors.brand.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
      <LinearGradient colors={['#070A14', '#0A0F22', '#060913']} style={StyleSheet.absoluteFill} />

      <Animated.View style={[styles.inner, { opacity: fadeAnim }]}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          scrollEnabled={false}
          bounces={false}
          overScrollMode="never"
        >
          {/* Header Card with Scenic Illustration Background */}
          <View style={styles.headerCard}>
            {/* Background image - figures naturally on right side */}
            <Image
              source={require('../../assets/header_bg_clean.png')}
              style={styles.headerBgImage}
              resizeMode="cover"
            />
            {/* Subtle mask on left so text is crisp while preserving sunset on right */}
            <LinearGradient
              colors={['rgba(7, 10, 19, 0.72)', 'rgba(7, 10, 19, 0.45)', 'rgba(7, 10, 19, 0.10)', 'transparent']}
              style={StyleSheet.absoluteFill}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 0.75, y: 0.5 }}
            />
            {/* Smooth bottom fade into screen background */}
            <LinearGradient
              colors={['transparent', 'rgba(7, 10, 19, 0.35)', 'rgba(7, 10, 19, 0.85)']}
              style={styles.bottomGradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 1 }}
            />

            {/* Content Container */}
            <View style={styles.headerContent}>
              {/* Top row: Weather / Greeting (Left) & Avatar Ring (Right) */}
              <View style={styles.headerTopRow}>
                <View style={styles.weatherGreetingBox}>
                  <Icon name={greeting.icon} size={22} color={greeting.color || '#F59E0B'} style={styles.weatherIcon} />
                  <View style={styles.greetingTextCol}>
                    <Text style={[styles.greetingTitle, { color: greeting.color || '#F59E0B' }]}>{greeting.text}</Text>
                    <Text style={styles.greetingSub}>{greeting.dateStr}</Text>
                  </View>
                </View>

                {/* Avatar with gradient border ring */}
                <TouchableOpacity
                  style={styles.avatarContainer}
                  onPress={() => navigation.navigate('SettingsTab')}
                  activeOpacity={0.85}
                >
                  <LinearGradient
                    colors={['#22D3EE', '#818CF8', '#C084FC']}
                    style={styles.avatarRing}
                    start={{ x: 0, y: 1 }}
                    end={{ x: 1, y: 0 }}
                  >
                    <View style={styles.avatarInner}>
                      <Text style={styles.avatarText}>{parentInitials}</Text>
                    </View>
                  </LinearGradient>
                  <View style={styles.avatarStatusDot} />
                </TouchableOpacity>
              </View>

              {/* Name row - 2 lines matching attached mockup */}
              <Text style={styles.parentName}>
                {parentName ? parentName.replace(' ', '\n') : 'Thanushka\nJayasinghe'}{' '}
                <Text style={styles.waveEmoji}>👋</Text>
              </Text>

              {/* Subtitle matching attached image */}
              <Text style={styles.parentSubtitle}>
                Hope you and your little one{'\n'}had a great day!
              </Text>

              {/* Badges row: Children count + Online count */}
              <View style={styles.pillsRow}>
                <View style={styles.childPill}>
                  <Icon name="people" size={15} color="#818CF8" />
                  <Text style={styles.childPillText}>
                    {children.length} {children.length === 1 ? 'child' : 'children'}
                  </Text>
                </View>

                <View style={styles.onlinePill}>
                  <View style={styles.onlinePillDot} />
                  <Text style={styles.onlinePillText}>
                    {onlineCount} online
                  </Text>
                </View>
              </View>
            </View>
          </View>

          {/* Main Body Content with side padding */}
          <View style={styles.bodyContent}>
            {children.length === 0 ? (
              <EmptyState onPair={() => navigation.navigate('PairTab')} />
            ) : (
              <>
                {/* Header matching media_1790089662308.png: Left title, Center dots, Right controls */}
                <View style={styles.sectionHeaderContainer}>
                  <Text style={styles.sectionTitle}>YOUR CHILDREN</Text>

                  {/* Centered Pagination Dots */}
                  {children.length > 1 && (
                    <View style={styles.dotsCenterContainer} pointerEvents="box-none">
                      {children.map((_, idx) => (
                        <TouchableOpacity
                          key={idx}
                          onPress={() => {
                            flatListRef.current?.scrollToIndex({ index: idx, animated: true });
                            setActiveChildIndex(idx);
                          }}
                          activeOpacity={0.7}
                          hitSlop={{ top: 12, bottom: 12, left: 6, right: 6 }}
                        >
                          <View
                            style={[
                              styles.paginationDot,
                              idx === activeChildIndex && styles.paginationDotActive,
                            ]}
                          />
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}

                  {/* Right-side Arrow and Counter Controls */}
                  {children.length > 1 ? (
                    <View style={styles.carouselControlsRow}>
                      <TouchableOpacity
                        style={[
                          styles.arrowButton,
                          activeChildIndex === 0 && styles.arrowButtonDisabled,
                        ]}
                        onPress={() => {
                          if (activeChildIndex > 0) {
                            const nextIdx = activeChildIndex - 1;
                            flatListRef.current?.scrollToIndex({ index: nextIdx, animated: true });
                            setActiveChildIndex(nextIdx);
                          }
                        }}
                        disabled={activeChildIndex === 0}
                        activeOpacity={0.7}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Icon
                          name="chevron-back"
                          size={17}
                          color={activeChildIndex === 0 ? '#475569' : '#CBD5E1'}
                        />
                      </TouchableOpacity>

                      <Text style={styles.carouselCounterText}>
                        {activeChildIndex + 1} <Text style={styles.carouselCounterSlash}>/</Text> {children.length}
                      </Text>

                      <TouchableOpacity
                        style={[
                          styles.arrowButton,
                          activeChildIndex === children.length - 1 && styles.arrowButtonDisabled,
                        ]}
                        onPress={() => {
                          if (activeChildIndex < children.length - 1) {
                            const nextIdx = activeChildIndex + 1;
                            flatListRef.current?.scrollToIndex({ index: nextIdx, animated: true });
                            setActiveChildIndex(nextIdx);
                          }
                        }}
                        disabled={activeChildIndex === children.length - 1}
                        activeOpacity={0.7}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Icon
                          name="chevron-forward"
                          size={17}
                          color={activeChildIndex === children.length - 1 ? '#475569' : '#CBD5E1'}
                        />
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <View style={{ width: 1 }} />
                  )}
                </View>

                {/* Horizontal swipeable carousel - no vertical scroll needed */}
                <FlatList
                  ref={flatListRef}
                  data={children}
                  keyExtractor={(item) => item.id.toString()}
                  horizontal
                  pagingEnabled
                  showsHorizontalScrollIndicator={false}
                  decelerationRate="fast"
                  snapToInterval={CARD_WIDTH}
                  snapToAlignment="start"
                  bounces={false}
                  onMomentumScrollEnd={(event) => {
                    const offsetX = event.nativeEvent.contentOffset.x;
                    const index = Math.round(offsetX / CARD_WIDTH);
                    if (index >= 0 && index < children.length) {
                      setActiveChildIndex(index);
                    }
                  }}
                  getItemLayout={(data, index) => ({
                    length: CARD_WIDTH,
                    offset: CARD_WIDTH * index,
                    index,
                  })}
                  renderItem={({ item: child }) => (
                    <View style={{ width: CARD_WIDTH }}>
                      <ChildStatusCard
                        child={child}
                        status={childStatuses[child.id]}
                        onViewMap={() => navigation.navigate('MapTab', { childId: child.id })}
                        onViewHistory={() => navigation.navigate('HistoryTab', { childId: child.id })}
                        onPairDevice={() => navigation.navigate('PairTab', { childId: child.id })}
                        onDelete={() => handleDeleteChild(child)}
                        onAvatarUpdated={(childId, newAvatarUrl) => {
                          setChildren((prev) =>
                            prev.map((c) => (c.id === childId ? { ...c, avatar_url: newAvatarUrl } : c))
                          );
                        }}
                      />
                    </View>
                  )}
                />
              </>
            )}
          </View>
        </ScrollView>
      </Animated.View>
    </View>
  );
}

function EmptyState({ onPair }) {
  return (
    <View style={emptyStyles.container}>
      {/* 3D Shield with Heart & Radiant Sparks (User Artwork) */}
      <View style={emptyStyles.shieldImageWrapper}>
        <Image
          source={require('../../assets/empty_shield.png')}
          style={emptyStyles.shieldImage}
          resizeMode="contain"
        />
      </View>

      <Text style={emptyStyles.title}>No children added yet</Text>
      <Text style={emptyStyles.desc}>
        Pair your child's device to start monitoring{'\n'}their location and safety.
      </Text>

      {/* Radiant "Pair a device" Button (Matching Image 2) */}
      <TouchableOpacity
        style={emptyStyles.pairBtnTouchable}
        onPress={onPair}
        activeOpacity={0.85}
      >
        <LinearGradient
          colors={['#38BDF8', '#6366F1', '#A855F7']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={emptyStyles.pairBtnGradBorder}
        >
          <View style={emptyStyles.pairBtnInner}>
            <Icon name="qr-code-outline" size={22} color="#FFFFFF" style={emptyStyles.pairBtnQrIcon} />
            <Text style={emptyStyles.pairBtnText}>Pair a device</Text>
            <Icon name="chevron-forward" size={18} color="#FFFFFF" />
          </View>
        </LinearGradient>
      </TouchableOpacity>
    </View>
  );
}

const emptyStyles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingTop: 2,
    paddingHorizontal: 20,
  },
  shieldImageWrapper: {
    width: 310,
    height: 200,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 0,
    marginBottom: 10,
  },
  shieldImage: {
    width: '100%',
    height: '100%',
  },
  title: {
    fontFamily: Fonts?.bold || 'sans-serif-bold',
    fontSize: 22,
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: 6,
    letterSpacing: -0.3,
  },
  desc: {
    fontFamily: Fonts?.regular || 'sans-serif',
    fontSize: 13.5,
    color: '#8E9BB5',
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 310,
    marginBottom: 18,
  },
  pairBtnTouchable: {
    width: '100%',
    maxWidth: 320,
    height: 48,
    borderRadius: 24,
    overflow: 'hidden',
  },
  pairBtnGradBorder: {
    flex: 1,
    padding: 1.8,
    borderRadius: 26,
  },
  pairBtnInner: {
    flex: 1,
    backgroundColor: '#0F172A',
    borderRadius: 24.2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
  },
  pairBtnQrIcon: {
    marginRight: 4,
  },
  pairBtnText: {
    fontFamily: Fonts?.bold || 'sans-serif-bold',
    fontSize: 16,
    color: '#FFFFFF',
    flex: 1,
    textAlign: 'center',
  },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#070A13' },
  inner: { flex: 1, paddingTop: 0, backgroundColor: '#070A13' },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#070A13' },
  scroll: { flex: 1, backgroundColor: '#070A13' },
  scrollContent: { paddingHorizontal: 0, paddingBottom: 0, backgroundColor: '#070A13', flexGrow: 1 },
  bodyContent: { paddingHorizontal: 16, flex: 1 },

  headerCard: {
    backgroundColor: '#070A13',
    width: '100%',
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    borderBottomLeftRadius: 36,
    borderBottomRightRadius: 36,
    borderWidth: 0,
    marginBottom: 0,
    position: 'relative',
    overflow: 'hidden',
    minHeight: 260,
  },
  headerBgImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
  },
  bottomGradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 55,
  },
  headerContent: {
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 24) + 12 : 50,
    paddingLeft: 22,
    paddingRight: 20,
    paddingBottom: 22,
    zIndex: 2,
    minHeight: 320,
    justifyContent: 'space-between',
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  weatherGreetingBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  weatherIcon: {
    marginTop: -1,
  },
  greetingTextCol: {
    justifyContent: 'center',
  },
  greetingTitle: {
    fontFamily: Fonts?.semiBold || 'sans-serif-medium',
    fontSize: 15.5,
    color: '#F59E0B',
    lineHeight: 19,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  greetingSub: {
    fontFamily: Fonts?.medium || 'sans-serif',
    fontSize: 12.5,
    color: '#94A3B8',
    lineHeight: 16,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  avatarContainer: {
    position: 'relative',
  },
  avatarRing: {
    width: 48,
    height: 48,
    borderRadius: 24,
    padding: 2.2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInner: {
    width: '100%',
    height: '100%',
    borderRadius: 22,
    backgroundColor: '#0B101D',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontFamily: Fonts?.bold || 'sans-serif-bold',
    fontSize: 15,
    color: '#FFFFFF',
  },
  avatarStatusDot: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 11,
    height: 11,
    borderRadius: 5.5,
    backgroundColor: '#22C55E',
    borderWidth: 2,
    borderColor: '#0B101D',
  },
  parentName: {
    fontFamily: Fonts?.bold || 'sans-serif-bold',
    fontSize: 27,
    color: '#FFFFFF',
    lineHeight: 33,
    letterSpacing: -0.3,
    marginBottom: 6,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
    maxWidth: 240,
  },
  waveEmoji: {
    fontSize: 22,
  },
  parentSubtitle: {
    fontFamily: Fonts?.regular || 'sans-serif',
    fontSize: 14,
    color: '#CBD5E1',
    lineHeight: 19,
    marginBottom: 16,
    maxWidth: 240,
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  pillsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  childPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(30, 27, 75, 0.65)',
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(129, 140, 248, 0.35)',
  },
  childPillText: {
    fontFamily: Fonts?.medium || 'sans-serif-medium',
    fontSize: 12.5,
    color: '#E2E8F0',
  },
  onlinePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: 'rgba(6, 44, 38, 0.65)',
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.35)',
  },
  onlinePillDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#22C55E',
  },
  onlinePillText: {
    fontFamily: Fonts?.medium || 'sans-serif-medium',
    fontSize: 12.5,
    color: '#22C55E',
  },
  pairBtn: {
    width: '100%',
    height: 48,
    borderRadius: 24,
    overflow: 'hidden',
    shadowColor: '#8B5CF6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 4,
  },
  pairBtnGrad: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    gap: 8,
  },
  pairBtnText: {
    fontFamily: Fonts?.bold || 'sans-serif-bold',
    fontSize: 16,
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },
  sectionHeaderContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    paddingHorizontal: 4,
    position: 'relative',
    minHeight: 34,
  },
  sectionTitle: {
    fontFamily: Fonts?.bold || 'sans-serif-bold',
    fontSize: 13,
    color: '#94A3B8',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },
  dotsCenterContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  paginationDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#334155',
  },
  paginationDotActive: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
    backgroundColor: '#C084FC',
    shadowColor: '#C084FC',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 6,
    elevation: 4,
  },
  carouselControlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  arrowButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(30, 41, 59, 0.65)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrowButtonDisabled: {
    opacity: 0.35,
  },
  carouselCounterText: {
    fontFamily: Fonts?.semiBold || 'sans-serif-medium',
    fontSize: 13.5,
    color: '#E2E8F0',
    marginHorizontal: 10,
  },
  carouselCounterSlash: {
    color: '#64748B',
    fontWeight: 'normal',
  },
});
