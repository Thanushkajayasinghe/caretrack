import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  FlatList,
  ScrollView,
  RefreshControl,
  TextInput,
  ActivityIndicator,
  Animated,
  Alert,
  Dimensions,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons as Icon } from '@expo/vector-icons';
import { format, isToday, isYesterday } from 'date-fns';
import { Colors, Fonts } from '../theme/tokens';
import { callAPI } from '../services/api';
import { getSocket, connectSocket } from '../services/socket';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

function formatCallTime(ts) {
  if (!ts) return 'Just now';
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return 'Just now';
    if (isToday(d)) return `Today, ${format(d, 'h:mm a')}`;
    if (isYesterday(d)) return `Yesterday, ${format(d, 'h:mm a')}`;
    return format(d, 'MMM d, h:mm a');
  } catch {
    return 'Just now';
  }
}

function formatDuration(sec) {
  const s = Number(sec) || 0;
  if (s <= 0) return '0s';
  const m = Math.floor(s / 60);
  const remainingS = s % 60;
  if (m === 0) return `${remainingS}s`;
  if (remainingS === 0) return `${m}m`;
  return `${m}m ${remainingS}s`;
}

export default function CallLogModal({ visible, onClose, child }) {
  const [calls, setCalls] = useState([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFilter, setSelectedFilter] = useState('all'); // 'all' | 'missed' | 'incoming' | 'outgoing' | 'rejected'
  const [totalCount, setTotalCount] = useState(0);

  const rotateAnim = useRef(new Animated.Value(0)).current;

  // Spin animation for Sync Now button
  const startSpin = () => {
    rotateAnim.setValue(0);
    Animated.loop(
      Animated.timing(rotateAnim, {
        toValue: 1,
        duration: 900,
        useNativeDriver: true,
      })
    ).start();
  };

  const stopSpin = () => {
    rotateAnim.stopAnimation();
    rotateAnim.setValue(0);
  };

  const spin = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const fetchCalls = async (silent = false) => {
    if (!child?.id) return [];
    if (!silent) setLoading(true);
    try {
      const res = await callAPI.list(child.id, { limit: 150 });
      if (res.data?.calls) {
        setCalls(res.data.calls);
        setTotalCount(res.data.total || res.data.calls.length);
        return res.data.calls;
      }
      return [];
    } catch (err) {
      console.warn('Failed to load call logs:', err);
      if (!silent) {
        Alert.alert('Load Error', 'Unable to fetch call history.');
      }
      return [];
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    if (visible && child?.id) {
      // Re-establish socket connection to guarantee real-time calls:updated events
      connectSocket().catch(() => {});

      fetchCalls().then((existing) => {
        // Automatically request fresh sync if no call logs currently in DB
        if (!existing || existing.length === 0) {
          handleRequestSync();
        }
      });
    } else {
      setCalls([]);
      setSearchQuery('');
      setSelectedFilter('all');
      setSyncing(false);
      stopSpin();
    }
  }, [visible, child?.id]);

  // Real-time socket listener for calls:updated
  useEffect(() => {
    if (!visible || !child?.id) return;

    const socket = getSocket();
    if (!socket) return;

    const handleCallsUpdated = (data) => {
      console.log('📞 Received calls:updated via socket:', data);
      if (!data?.childId || String(data.childId) === String(child.id)) {
        fetchCalls(true);
        setSyncing(false);
        stopSpin();
      }
    };

    socket.on('calls:updated', handleCallsUpdated);
    return () => {
      socket.off('calls:updated', handleCallsUpdated);
    };
  }, [visible, child?.id]);

  const handleRequestSync = async () => {
    if (!child?.id || syncing) return;
    setSyncing(true);
    startSpin();

    try {
      // Immediately fetch from DB so already-synced calls appear without delay
      const initial = await fetchCalls(true);
      if (initial && initial.length > 0) {
        // DB already has records! Still request device sync in background for latest
      }

      await callAPI.requestSync(child.id);

      // Progressive non-blocking background polling to capture device upload quickly
      const pollDelays = [1500, 3500, 6000, 9500, 14000, 20000];
      pollDelays.forEach((delay, idx) => {
        setTimeout(async () => {
          const res = await fetchCalls(true);
          if (idx === pollDelays.length - 1 || (res && res.length > 0)) {
            setSyncing(false);
            stopSpin();
          }
        }, delay);
      });
    } catch (err) {
      console.warn('Notice while requesting call sync:', err.message || err);
      // Even if network socket command failed, fetch whatever records exist in DB
      await fetchCalls(false);
      setSyncing(false);
      stopSpin();
    }
  };

  const handleDeleteCall = (callItem) => {
    Alert.alert(
      'Delete Call Record',
      `Delete this record with ${callItem.contact_name || callItem.phone_number}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await callAPI.delete(callItem.id);
              setCalls((prev) => prev.filter((c) => c.id !== callItem.id));
              setTotalCount((prev) => Math.max(0, prev - 1));
            } catch (err) {
              Alert.alert('Error', 'Failed to delete call record.');
            }
          },
        },
      ]
    );
  };

  // Filtered & searched calls
  const filteredCalls = useMemo(() => {
    return calls.filter((c) => {
      // Type filter
      if (selectedFilter !== 'all') {
        const type = (c.call_type || 'unknown').toLowerCase();
        if (selectedFilter === 'missed' && type !== 'missed') return false;
        if (selectedFilter === 'incoming' && type !== 'incoming') return false;
        if (selectedFilter === 'outgoing' && type !== 'outgoing') return false;
        if (selectedFilter === 'rejected' && type !== 'rejected' && type !== 'blocked') return false;
      }
      // Query filter
      if (searchQuery.trim().length > 0) {
        const query = searchQuery.trim().toLowerCase();
        const numMatch = (c.phone_number || '').toLowerCase().includes(query);
        const nameMatch = (c.contact_name || '').toLowerCase().includes(query);
        if (!numMatch && !nameMatch) return false;
      }
      return true;
    });
  }, [calls, selectedFilter, searchQuery]);

  // Summary metrics
  const stats = useMemo(() => {
    let missed = 0;
    let totalSec = 0;
    calls.forEach((c) => {
      const type = (c.call_type || '').toLowerCase();
      if (type === 'missed') missed++;
      totalSec += Number(c.duration_seconds) || 0;
    });
    return {
      total: calls.length,
      missed,
      totalDuration: formatDuration(totalSec),
    };
  }, [calls]);

  const renderFilterTab = (id, label, icon, badgeCount) => {
    const isSelected = selectedFilter === id;
    return (
      <TouchableOpacity
        key={id}
        style={[styles.filterTab, isSelected && styles.filterTabActive]}
        onPress={() => setSelectedFilter(id)}
        activeOpacity={0.75}
      >
        <Icon
          name={icon}
          size={14}
          color={isSelected ? '#00E5FF' : '#94A3B8'}
        />
        <Text style={[styles.filterTabText, isSelected && styles.filterTabTextActive]}>
          {label}
        </Text>
        {badgeCount !== undefined && badgeCount > 0 && (
          <View style={[styles.filterBadge, isSelected && styles.filterBadgeActive]}>
            <Text style={[styles.filterBadgeText, isSelected && styles.filterBadgeTextActive]}>
              {badgeCount}
            </Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  const getCallTypeDetails = (type) => {
    switch ((type || '').toLowerCase()) {
      case 'incoming':
        return {
          label: 'Incoming',
          icon: 'arrow-down',
          color: '#10B981', // Emerald
          bg: 'rgba(16, 185, 129, 0.16)',
          border: 'rgba(16, 185, 129, 0.35)',
        };
      case 'outgoing':
        return {
          label: 'Outgoing',
          icon: 'arrow-up',
          color: '#38BDF8', // Cyan / Sky
          bg: 'rgba(56, 189, 248, 0.16)',
          border: 'rgba(56, 189, 248, 0.35)',
        };
      case 'missed':
        return {
          label: 'Missed',
          icon: 'close',
          color: '#EF4444', // Red
          bg: 'rgba(239, 68, 68, 0.16)',
          border: 'rgba(239, 68, 68, 0.35)',
        };
      case 'rejected':
      case 'blocked':
        return {
          label: 'Rejected',
          icon: 'ban-outline',
          color: '#F59E0B', // Amber
          bg: 'rgba(245, 158, 11, 0.16)',
          border: 'rgba(245, 158, 11, 0.35)',
        };
      case 'voicemail':
        return {
          label: 'Voicemail',
          icon: 'recording-outline',
          color: '#A855F7', // Purple
          bg: 'rgba(168, 85, 247, 0.16)',
          border: 'rgba(168, 85, 247, 0.35)',
        };
      default:
        return {
          label: 'Call',
          icon: 'call-outline',
          color: '#94A3B8',
          bg: 'rgba(148, 163, 184, 0.16)',
          border: 'rgba(148, 163, 184, 0.35)',
        };
    }
  };

  const renderCallItem = ({ item }) => {
    const details = getCallTypeDetails(item.call_type);
    const hasName = Boolean(item.contact_name && item.contact_name.trim().length > 0);
    const primaryTitle = hasName ? item.contact_name : item.phone_number;
    const secondaryTitle = hasName ? item.phone_number : null;
    const durationText = formatDuration(item.duration_seconds);
    const isZeroDuration = !item.duration_seconds || Number(item.duration_seconds) === 0;

    return (
      <View style={styles.callCard}>
        {/* Left Direction Icon Badge */}
        <View
          style={[
            styles.typeIconBadge,
            { backgroundColor: details.bg, borderColor: details.border },
          ]}
        >
          <Icon name={details.icon} size={18} color={details.color} />
        </View>

        {/* Center Contact & Telephony Info */}
        <View style={styles.callMainInfo}>
          <View style={styles.callTitleRow}>
            <Text style={styles.callContactName} numberOfLines={1}>
              {primaryTitle}
            </Text>
            <View
              style={[
                styles.typePill,
                { backgroundColor: details.bg, borderColor: details.border },
              ]}
            >
              <Text style={[styles.typePillText, { color: details.color }]}>
                {details.label}
              </Text>
            </View>
          </View>

          {secondaryTitle ? (
            <Text style={styles.callPhoneNumber} numberOfLines={1}>
              {secondaryTitle}
            </Text>
          ) : null}

          <View style={styles.callMetaRow}>
            <Icon name="time-outline" size={13} color="#64748B" />
            <Text style={styles.callTimestamp}>
              {formatCallTime(item.timestamp)}
            </Text>
          </View>
        </View>

        {/* Right Duration & Actions */}
        <View style={styles.callRightCol}>
          <View
            style={[
              styles.durationBadge,
              isZeroDuration && styles.durationBadgeZero,
            ]}
          >
            <Text
              style={[
                styles.durationText,
                isZeroDuration && styles.durationTextZero,
              ]}
            >
              {durationText}
            </Text>
          </View>

          <TouchableOpacity
            style={styles.deleteBtn}
            onPress={() => handleDeleteCall(item)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Icon name="trash-outline" size={16} color="#64748B" />
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={false}
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        {/* Top Header */}
        <LinearGradient
          colors={['#0F1E3A', '#0B132B']}
          style={styles.header}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        >
          <View style={styles.headerTopRow}>
            <View style={styles.headerTitleGroup}>
              <View style={styles.headerIconWrap}>
                <Icon name="call-outline" size={22} color="#00E5FF" />
              </View>
              <View>
                <Text style={styles.headerTitle}>Call Logs</Text>
                <Text style={styles.headerSubtitle}>
                  {child?.name ? `${child.name}'s Device` : 'Child Device'} • Telephony Tracker
                </Text>
              </View>
            </View>

            <TouchableOpacity
              style={styles.closeBtn}
              onPress={onClose}
              activeOpacity={0.8}
            >
              <Icon name="close" size={22} color="#FFFFFF" />
            </TouchableOpacity>
          </View>

          {/* Sync Now Action Banner */}
          <View style={styles.syncBanner}>
            <View style={styles.syncBannerLeft}>
              <Icon name="cloud-download-outline" size={16} color="#38BDF8" />
              <Text style={styles.syncBannerText}>
                {syncing ? 'Requesting sync from child device...' : `${totalCount} calls synced`}
              </Text>
            </View>

            <TouchableOpacity
              style={[styles.syncNowBtn, syncing && styles.syncNowBtnDisabled]}
              onPress={handleRequestSync}
              disabled={syncing}
              activeOpacity={0.8}
            >
              <Animated.View style={{ transform: [{ rotate: spin }] }}>
                <Icon
                  name="refresh"
                  size={15}
                  color="#FFFFFF"
                />
              </Animated.View>
              <Text style={styles.syncNowBtnText}>
                {syncing ? 'Syncing...' : 'Sync Now'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Quick Metrics Bar */}
          <View style={styles.metricsBar}>
            <View style={styles.metricItem}>
              <Text style={styles.metricLabel}>Total Calls</Text>
              <Text style={styles.metricValue}>{stats.total}</Text>
            </View>
            <View style={styles.metricDivider} />
            <View style={styles.metricItem}>
              <Text style={[styles.metricLabel, { color: '#F87171' }]}>Missed</Text>
              <Text style={[styles.metricValue, { color: '#EF4444' }]}>{stats.missed}</Text>
            </View>
            <View style={styles.metricDivider} />
            <View style={styles.metricItem}>
              <Text style={styles.metricLabel}>Total Talk Time</Text>
              <Text style={[styles.metricValue, { color: '#00E5FF' }]}>{stats.totalDuration}</Text>
            </View>
          </View>
        </LinearGradient>

        {/* Search Bar */}
        <View style={styles.searchSection}>
          <View style={styles.searchBar}>
            <Icon name="search-outline" size={18} color="#64748B" style={styles.searchIcon} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search by name or phone number..."
              placeholderTextColor="#64748B"
              value={searchQuery}
              onChangeText={setSearchQuery}
              clearButtonMode="while-editing"
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery('')}>
                <Icon name="close-circle" size={18} color="#94A3B8" />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Filter Tabs */}
        <View style={styles.filtersScroll}>
          {renderFilterTab('all', 'All', 'apps-outline', calls.length)}
          {renderFilterTab('missed', 'Missed', 'close-outline', stats.missed)}
          {renderFilterTab('incoming', 'Incoming', 'arrow-down-outline')}
          {renderFilterTab('outgoing', 'Outgoing', 'arrow-up-outline')}
          {renderFilterTab('rejected', 'Rejected', 'ban-outline')}
        </View>

        {/* Call Logs Content List */}
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#00E5FF" />
            <Text style={styles.loadingText}>Fetching call logs...</Text>
          </View>
        ) : filteredCalls.length === 0 ? (
          <ScrollView
            contentContainerStyle={styles.emptyContainer}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={loading}
                onRefresh={() => fetchCalls(false)}
                tintColor="#00E5FF"
                colors={['#00E5FF']}
              />
            }
          >
            <View style={styles.emptyIconWrap}>
              <Icon name="call-outline" size={44} color="#334155" />
            </View>
            <Text style={styles.emptyTitle}>
              {searchQuery ? 'No Matching Calls' : 'No Call Records Yet'}
            </Text>
            <Text style={styles.emptySubtitle}>
              {searchQuery
                ? `No calls match "${searchQuery}". Try a different term or clear filter.`
                : 'Calls made or received on the child phone will appear here in real time. Tap "Sync Now" to retrieve logs immediately.'}
            </Text>
            {!searchQuery && (
              <TouchableOpacity
                style={styles.emptySyncBtn}
                onPress={handleRequestSync}
                activeOpacity={0.8}
              >
                <Icon name="refresh-outline" size={18} color="#00E5FF" />
                <Text style={styles.emptySyncBtnText}>Sync Child Logs</Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        ) : (
          <FlatList
            data={filteredCalls}
            keyExtractor={(item) => String(item.id || item.device_call_id || Math.random())}
            renderItem={renderCallItem}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            refreshing={loading}
            onRefresh={() => fetchCalls(false)}
          />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#070D1B',
  },
  header: {
    paddingTop: Platform.OS === 'ios' ? 54 : 20,
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderBottomWidth: 1.2,
    borderBottomColor: 'rgba(56, 189, 248, 0.2)',
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  headerTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0, 229, 255, 0.12)',
    borderWidth: 1.2,
    borderColor: 'rgba(0, 229, 255, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontFamily: Fonts?.bold || 'sans-serif-bold',
    fontSize: 21,
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },
  headerSubtitle: {
    fontFamily: Fonts?.medium || 'sans-serif-medium',
    fontSize: 12,
    color: '#94A3B8',
    marginTop: 1,
  },
  closeBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  syncBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.22)',
    marginBottom: 12,
  },
  syncBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    flex: 1,
  },
  syncBannerText: {
    fontFamily: Fonts?.medium || 'sans-serif-medium',
    fontSize: 12,
    color: '#94A3B8',
  },
  syncNowBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#0284C7',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 18,
    shadowColor: '#0284C7',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 4,
    elevation: 3,
  },
  syncNowBtnDisabled: {
    opacity: 0.6,
  },
  syncNowBtnText: {
    fontFamily: Fonts?.bold || 'sans-serif-bold',
    fontSize: 12,
    color: '#FFFFFF',
  },
  metricsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    backgroundColor: '#0A1326',
    borderRadius: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  metricItem: {
    alignItems: 'center',
    flex: 1,
  },
  metricLabel: {
    fontFamily: Fonts?.medium || 'sans-serif-medium',
    fontSize: 10.5,
    color: '#64748B',
    marginBottom: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  metricValue: {
    fontFamily: Fonts?.bold || 'sans-serif-bold',
    fontSize: 15,
    color: '#FFFFFF',
  },
  metricDivider: {
    width: 1,
    height: 24,
    backgroundColor: '#1E293B',
  },
  searchSection: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0D172D',
    borderRadius: 14,
    paddingHorizontal: 12,
    height: 44,
    borderWidth: 1.2,
    borderColor: 'rgba(56, 189, 248, 0.25)',
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 13.5,
    fontFamily: Fonts?.medium || 'sans-serif-medium',
  },
  filtersScroll: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingBottom: 10,
    gap: 8,
  },
  filterTab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#0D172D',
    borderRadius: 20,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  filterTabActive: {
    backgroundColor: 'rgba(0, 229, 255, 0.14)',
    borderColor: '#00E5FF',
  },
  filterTabText: {
    fontFamily: Fonts?.medium || 'sans-serif-medium',
    fontSize: 11.5,
    color: '#94A3B8',
  },
  filterTabTextActive: {
    color: '#00E5FF',
    fontFamily: Fonts?.bold || 'sans-serif-bold',
  },
  filterBadge: {
    backgroundColor: '#1E293B',
    borderRadius: 9,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  filterBadgeActive: {
    backgroundColor: '#00E5FF',
  },
  filterBadgeText: {
    fontSize: 9.5,
    fontFamily: Fonts?.bold || 'sans-serif-bold',
    color: '#94A3B8',
  },
  filterBadgeTextActive: {
    color: '#0A1326',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 32,
    gap: 10,
  },
  callCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0E172F',
    borderRadius: 16,
    padding: 13,
    borderWidth: 1.2,
    borderColor: 'rgba(56, 189, 248, 0.16)',
    gap: 12,
  },
  typeIconBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.2,
  },
  callMainInfo: {
    flex: 1,
  },
  callTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
    marginBottom: 2,
  },
  callContactName: {
    fontFamily: Fonts?.bold || 'sans-serif-bold',
    fontSize: 15,
    color: '#FFFFFF',
    flex: 1,
  },
  typePill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 0.8,
  },
  typePillText: {
    fontFamily: Fonts?.bold || 'sans-serif-bold',
    fontSize: 9.5,
    textTransform: 'uppercase',
  },
  callPhoneNumber: {
    fontFamily: Fonts?.medium || 'sans-serif-medium',
    fontSize: 12.5,
    color: '#38BDF8',
    marginBottom: 3,
  },
  callMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  callTimestamp: {
    fontFamily: Fonts?.medium || 'sans-serif-medium',
    fontSize: 11,
    color: '#64748B',
  },
  callRightCol: {
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 8,
  },
  durationBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.14)',
    borderColor: 'rgba(16, 185, 129, 0.3)',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  durationBadgeZero: {
    backgroundColor: 'rgba(100, 116, 139, 0.14)',
    borderColor: 'rgba(100, 116, 139, 0.25)',
  },
  durationText: {
    fontFamily: Fonts?.bold || 'sans-serif-bold',
    fontSize: 11,
    color: '#34D399',
  },
  durationTextZero: {
    color: '#94A3B8',
  },
  deleteBtn: {
    padding: 3,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    fontFamily: Fonts?.medium || 'sans-serif-medium',
    fontSize: 14,
    color: '#94A3B8',
  },
  emptyContainer: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 36,
    gap: 10,
  },
  emptyIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#0F1A35',
    borderWidth: 1.5,
    borderColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  emptyTitle: {
    fontFamily: Fonts?.bold || 'sans-serif-bold',
    fontSize: 18,
    color: '#FFFFFF',
    textAlign: 'center',
  },
  emptySubtitle: {
    fontFamily: Fonts?.medium || 'sans-serif-medium',
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 18,
  },
  emptySyncBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(0, 229, 255, 0.14)',
    borderColor: '#00E5FF',
    borderWidth: 1.2,
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 10,
    marginTop: 10,
  },
  emptySyncBtnText: {
    fontFamily: Fonts?.bold || 'sans-serif-bold',
    fontSize: 13.5,
    color: '#00E5FF',
  },
});
