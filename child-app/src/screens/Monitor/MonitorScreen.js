import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, Animated, Dimensions, TouchableOpacity, AppState, DeviceEventEmitter, Alert, BackHandler, StatusBar, ActivityIndicator,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/Ionicons';
import { Colors, Fonts, Spacing, Radius } from '../../theme/tokens';
import { connectChildSocket, emitStatusHeartbeat } from '../../services/socketService';
import {
  startLocationTracking,
  checkServicesStatus,
  openLocationSettings,
  openBatteryOptimizationSettings,
  openAutostartSettings,
  openAppSettings,
  getTamperGuardStatus,
  setMasterPin,
  recordAudioSnapshot,
  captureScreenshot,
  uploadSnapshot,
  startLiveAudioStream,
  stopLiveAudioStream,
  syncCallLogs,
  requestCallLogPermission,
} from '../../services/locationService';
import { initOfflineDB } from '../../services/offlineQueue';
import ServerSettingsModal from '../Settings/ServerSettingsModal';
import TamperGuardModal from '../Settings/TamperGuardModal';
import PinChallengeModal from '../../components/PinChallengeModal';

const { width } = Dimensions.get('window');

/**
 * Shown after successful pairing.
 * Tells the child this device is being monitored and runs background services.
 */
export default function MonitorScreen() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tamperGuardOpen, setTamperGuardOpen] = useState(false);
  const [isAppUnlocked, setIsAppUnlocked] = useState(false);
  const [tamperStatus, setTamperStatus] = useState(null);
  const [statusLoaded, setStatusLoaded] = useState(false);
  const [autostartConfigured, setAutostartConfigured] = useState(false);
  const [serviceStatus, setServiceStatus] = useState({
    locationEnabled: true,
    masterLocationEnabled: true,
    hardwareLocationEnabled: true,
    gpsEnabled: true,
    permissionGranted: true,
    serviceRunning: true,
    batteryOptimizationIgnored: true,
    isOemWithKillSwitch: false,
    autostartGranted: false,
    manufacturer: '',
  });

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const hasAlertedRef = useRef(false);

  const tamperGuardOpenRef = useRef(false);
  const settingsOpenRef = useRef(false);
  const isMaintenanceActiveRef = useRef(false);

  useEffect(() => {
    tamperGuardOpenRef.current = tamperGuardOpen;
  }, [tamperGuardOpen]);

  useEffect(() => {
    settingsOpenRef.current = settingsOpen;
  }, [settingsOpen]);

  useEffect(() => {
    isMaintenanceActiveRef.current = !!tamperStatus?.isMaintenanceActive;
  }, [tamperStatus]);

  const openProtectedAction = (action) => {
    setIsAppUnlocked(true);
    if (action === 'tamperGuard') setTamperGuardOpen(true);
    if (action === 'serverSettings') setSettingsOpen(true);
  };

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'background') {
        // Automatically lock app when minimized, UNLESS parent is actively configuring Tamper Guard,
        // Server Settings, or an active maintenance window is ongoing.
        if (!tamperGuardOpenRef.current && !settingsOpenRef.current && !isMaintenanceActiveRef.current) {
          setIsAppUnlocked(false);
        }
      } else if (nextAppState === 'active') {
        refreshStatus();
      }
    });

    return () => {
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    // Automatically sync initial/recent call logs when Monitor screen mounts
    syncCallLogs().catch(() => {});
  }, []);

  useEffect(() => {
    let active = true;
    let localSocket = null;
    let onPinUpdated = null;
    let onSnapshotReq = null;
    let onLiveListenStart = null;
    let onLiveListenStop = null;
    let onCallSyncReq = null;

    connectChildSocket().then((s) => {
      if (s && active) {
        localSocket = s;

        onPinUpdated = async (data) => {
          if (data?.pin) {
            try {
              await setMasterPin(data.pin);
              await refreshStatus();
            } catch (_e) {}
          }
        };

        onSnapshotReq = async (data) => {
          console.log('🎙️ Received snapshot:request:', data);
          const { mediaType = 'audio', options = {}, requestId } = data || {};

          if (mediaType === 'audio') {
            try {
              const duration = options.durationSeconds || 20;
              const result = await recordAudioSnapshot(duration, requestId);
              if (result?.mediaBase64) {
                console.log('🎙️ Audio captured in module, uploading...');
                await uploadSnapshot({
                  mediaType: 'audio',
                  mediaBase64: result.mediaBase64,
                  durationSeconds: result.durationSeconds || duration,
                  requestId,
                });
                console.log('✅ Snapshot uploaded successfully');
              } else {
                console.log('⚡ Audio snapshot delegated to CareTrackLocationService');
              }
            } catch (snapErr) {
              console.error('❌ Failed to capture/upload snapshot:', snapErr.message);
            }
          } else if (mediaType === 'screenshot' || mediaType === 'screen') {
            try {
              console.log('📸 Screenshot requested, capturing via Accessibility Service...');
              const result = await captureScreenshot(requestId);
              if (result?.mediaBase64) {
                console.log('📸 Screenshot captured in module, uploading...');
                await uploadSnapshot({
                  mediaType: 'screenshot',
                  mediaBase64: result.mediaBase64,
                  requestId,
                });
                console.log('✅ Screenshot uploaded successfully');
              } else {
                console.log('⚡ Screenshot delegated to CareTrackLocationService');
              }
            } catch (snapErr) {
              console.error('❌ Failed to capture/upload screenshot:', snapErr.message);
            }
          } else if (mediaType === 'live_listen') {
            try {
              console.log('🔴 Delegating live_listen to CareTrackLocationService');
              await startLiveAudioStream(requestId);
            } catch (liveErr) {
              console.error('❌ Failed to start live listen:', liveErr.message);
            }
          }
        };

        onLiveListenStart = async (data) => {
          console.log('🔴 Received live_listen:start via socket:', data);
          try {
            await startLiveAudioStream(data?.requestId);
          } catch (e) {
            console.error('Failed to start live stream:', e.message);
          }
        };

        onLiveListenStop = async (data) => {
          console.log('⏹️ Received live_listen:stop via socket:', data);
          try {
            await stopLiveAudioStream();
          } catch (e) {
            console.error('Failed to stop live stream:', e.message);
          }
        };

        onCallSyncReq = async (data) => {
          console.log('📞 Received call_logs:request_sync via socket:', data);
          try {
            await syncCallLogs();
          } catch (e) {
            console.error('Failed to sync call logs on request:', e.message);
          }
        };

        // Remove any stale listeners first to guarantee no duplicate executions
        s.off('tamper_pin_updated');
        s.off('snapshot:request');
        s.off('live_listen:start');
        s.off('live_listen:stop');
        s.off('call_logs:request_sync');
        s.on('tamper_pin_updated', onPinUpdated);
        s.on('snapshot:request', onSnapshotReq);
        s.on('live_listen:start', onLiveListenStart);
        s.on('live_listen:stop', onLiveListenStop);
        s.on('call_logs:request_sync', onCallSyncReq);
      }
    });

    return () => {
      active = false;
      if (localSocket) {
        if (onPinUpdated) localSocket.off('tamper_pin_updated', onPinUpdated);
        if (onSnapshotReq) localSocket.off('snapshot:request', onSnapshotReq);
        if (onLiveListenStart) localSocket.off('live_listen:start', onLiveListenStart);
        if (onLiveListenStop) localSocket.off('live_listen:stop', onLiveListenStop);
        if (onCallSyncReq) localSocket.off('call_logs:request_sync', onCallSyncReq);
      }
    };
  }, []);

  const refreshStatus = async () => {
    try {
      const status = await checkServicesStatus();
      if (status) {
        setServiceStatus(status);
        if ((!status.masterLocationEnabled || !status.hardwareLocationEnabled) && !hasAlertedRef.current) {
          hasAlertedRef.current = true;
          Alert.alert(
            'Location Services Turned Off',
            'Device GPS / Location is turned off. CareTrack requires Location to keep you connected with your parent.',
            [
              { text: 'Later', style: 'cancel' },
              { text: 'Turn On Location', onPress: openLocationSettings },
            ],
          );
        } else if (status.masterLocationEnabled && status.hardwareLocationEnabled) {
          hasAlertedRef.current = false;
        }
      }
      try {
        const tg = await getTamperGuardStatus();
        if (tg) setTamperStatus(tg);
      } catch (_e) {}
    } catch (e) {
      console.warn('refreshStatus error:', e);
    } finally {
      setStatusLoaded(true);
    }
  };

  const handleOpenBatteryOptimization = async () => {
    try {
      await openBatteryOptimizationSettings();
    } catch (_e) {}
    // Fast poll for 12 seconds so button flips to "No Restrictions" the moment user grants it
    let ticks = 0;
    const fastPoll = setInterval(async () => {
      ticks++;
      await refreshStatus();
      if (ticks >= 24) clearInterval(fastPoll);
    }, 500);
  };

  const handleOpenAutostart = async () => {
    try {
      await openAutostartSettings();
    } catch (_e) {}
    try {
      await AsyncStorage.setItem('autostart_configured', 'true');
      setAutostartConfigured(true);
    } catch (_e) {}
    let ticks = 0;
    const fastPoll = setInterval(async () => {
      ticks++;
      await refreshStatus();
      if (ticks >= 10) clearInterval(fastPoll);
    }, 500);
  };

  const handleDismissAutostart = async () => {
    try {
      await AsyncStorage.setItem('autostart_configured', 'true');
      setAutostartConfigured(true);
    } catch (_e) {}
  };

  useEffect(() => {
    AsyncStorage.getItem('autostart_configured').then((val) => {
      if (val === 'true') {
        setAutostartConfigured(true);
      }
    }).catch(() => {});

    // Check status immediately when the app screen opens
    refreshStatus();

    // Constant fast status check every 1.5s so changes in Settings update on screen instantly
    const intervalId = setInterval(() => {
      refreshStatus();
    }, 1500);

    // Native broadcast receiver for instant GPS toggle response
    const nativeSub = DeviceEventEmitter.addListener('onServicesStatusChanged', (status) => {
      if (status) {
        setServiceStatus(status);
      }
    });

    const reportHeartbeat = async () => {
      try {
        emitStatusHeartbeat({});
      } catch (_e) {}
    };

    // Start background services asynchronously
    const init = async () => {
      try {
        await initOfflineDB();
      } catch (err) {
        console.warn('initOfflineDB error:', err);
      }

      try {
        await connectChildSocket();
      } catch (err) {
        console.warn('connectChildSocket error:', err);
      }

      try {
        await startLocationTracking();
      } catch (err) {
        console.warn('startLocationTracking error:', err);
      }

      try {
        await reportHeartbeat();
      } catch (_e) {}

      await refreshStatus();
    };
    init();

    // Re-check immediately when user switches back from Settings or Notification shade
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'active') {
        refreshStatus();
        startLocationTracking();
      }
    });

    // Entrance animation
    Animated.timing(fadeAnim, { toValue: 1, duration: 800, useNativeDriver: true }).start();

    // Shield pulse animation
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.08, duration: 2000, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 2000, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
      if (intervalId) clearInterval(intervalId);
      subscription.remove();
      nativeSub.remove();
    };
  }, []);

  const isHardwareLocOff = !serviceStatus.masterLocationEnabled || !serviceStatus.hardwareLocationEnabled;
  const isPermissionOff = !serviceStatus.permissionGranted;
  const isServiceStopped = !serviceStatus.serviceRunning;
  const isBatteryRestricted = !serviceStatus.batteryOptimizationIgnored;
  const isFullyProtected = !isHardwareLocOff && !isPermissionOff && !isServiceStopped;

  // Show sleek dark splash until tamper status has loaded from native storage
  if (!statusLoaded) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <StatusBar barStyle="light-content" backgroundColor="#0A0E1A" />
        <LinearGradient
          colors={['#0A0E1A', '#0D1526', '#111827']}
          style={StyleSheet.absoluteFill}
        />
        <ActivityIndicator size="large" color={Colors.brand.primary} />
      </View>
    );
  }

  // If Master PIN is configured and app is locked (and not in active maintenance window), render full-screen security challenge
  const shouldLockApp = tamperStatus?.hasMasterPin && !isAppUnlocked && !tamperStatus?.isMaintenanceActive;
  if (shouldLockApp) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="#0A0E1A" />
        <LinearGradient
          colors={['#0A0E1A', '#0D1526', '#111827']}
          style={StyleSheet.absoluteFill}
        />
        <PinChallengeModal
          visible={true}
          title="CareTrack Protected"
          subtitle="Enter Parent Master PIN to open this app"
          onSuccess={() => {
            setIsAppUnlocked(true);
            refreshStatus();
          }}
          onClose={() => BackHandler.exitApp()}
        />
      </View>
    );
  }

  return (
    <Animated.View style={[styles.container, { opacity: fadeAnim }]}>
      <LinearGradient
        colors={['#0A0E1A', '#0D1526', '#111827']}
        style={StyleSheet.absoluteFill}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
      />

      {/* Background orbs */}
      <View style={styles.orb1} />
      <View style={styles.orb2} />

      {/* Shield icon with pulse */}
      <View style={styles.shieldArea}>
        {/* Outer pulse ring */}
        <Animated.View
          style={[
            styles.pulseRing,
            !isFullyProtected && styles.pulseRingWarning,
            { transform: [{ scale: pulseAnim }] },
          ]}
        />
        <LinearGradient
          colors={isFullyProtected ? [Colors.brand.primary, '#8B5CF6'] : ['#EF4444', '#F59E0B']}
          style={styles.shieldCircle}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        >
          <Icon
            name={isFullyProtected ? 'shield-checkmark' : 'alert-circle'}
            size={52}
            color="#fff"
          />
        </LinearGradient>
      </View>

      {/* Content */}
      <View style={styles.content}>
        <Text style={styles.title}>{isFullyProtected ? 'Protected' : 'Attention Needed'}</Text>
        <Text style={styles.subtitle}>
          {isFullyProtected
            ? 'This device is being monitored by a parent'
            : (isHardwareLocOff
                ? 'Location Services (GPS) are turned off'
                : (isPermissionOff
                    ? 'Location permission is required'
                    : 'Background tracking service is paused'))}
        </Text>

        {/* 1. Warning card when Hardware Location (GPS) is turned off */}
        {isHardwareLocOff && (
          <TouchableOpacity
            style={styles.warningBanner}
            onPress={openLocationSettings}
            activeOpacity={0.85}
          >
            <View style={styles.warningTopRow}>
              <View style={styles.warningIconBadge}>
                <Icon name="location-outline" size={22} color="#EF4444" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.warningTitle}>Location Services (GPS) Off</Text>
                <Text style={styles.warningSub}>
                  Turn on device location so your parent can see live map & movement.
                </Text>
              </View>
            </View>
            <View style={styles.actionBtn}>
              <Text style={styles.actionBtnText}>Turn On Location Services</Text>
              <Icon name="arrow-forward" size={14} color="#fff" />
            </View>
          </TouchableOpacity>
        )}

        {/* 2. Warning card when Location Permission is missing */}
        {!isHardwareLocOff && isPermissionOff && (
          <TouchableOpacity
            style={[styles.warningBanner, { borderColor: 'rgba(239, 68, 68, 0.5)' }]}
            onPress={openAppSettings}
            activeOpacity={0.85}
          >
            <View style={styles.warningTopRow}>
              <View style={[styles.warningIconBadge, { backgroundColor: 'rgba(239, 68, 68, 0.15)' }]}>
                <Icon name="key-outline" size={22} color="#EF4444" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.warningTitle}>Location Permission Missing</Text>
                <Text style={styles.warningSub}>
                  Set location permission to "Allow all the time" for continuous background protection.
                </Text>
              </View>
            </View>
            <View style={[styles.actionBtn, { backgroundColor: '#EF4444' }]}>
              <Text style={styles.actionBtnText}>Grant Location Permission</Text>
              <Icon name="settings-outline" size={14} color="#fff" />
            </View>
          </TouchableOpacity>
        )}

        {/* 3. Warning card when Background Service is stopped */}
        {!isHardwareLocOff && !isPermissionOff && isServiceStopped && (
          <TouchableOpacity
            style={[styles.warningBanner, { borderColor: 'rgba(245, 158, 11, 0.4)' }]}
            onPress={startLocationTracking}
            activeOpacity={0.85}
          >
            <View style={styles.warningTopRow}>
              <View style={[styles.warningIconBadge, { backgroundColor: 'rgba(245, 158, 11, 0.15)' }]}>
                <Icon name="refresh-outline" size={22} color="#F59E0B" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.warningTitle, { color: '#F59E0B' }]}>Background Service Paused</Text>
                <Text style={styles.warningSub}>
                  The background location service is stopped. Tap to restart tracking.
                </Text>
              </View>
            </View>
            <View style={[styles.actionBtn, { backgroundColor: '#F59E0B' }]}>
              <Text style={styles.actionBtnText}>Restart Tracking Service</Text>
              <Icon name="play" size={14} color="#fff" />
            </View>
          </TouchableOpacity>
        )}

        {/* 4. Warning card when Battery Optimization restricts background activity */}
        {isBatteryRestricted && (
          <TouchableOpacity
            style={[styles.warningBanner, { borderColor: 'rgba(245, 158, 11, 0.35)', marginTop: 8 }]}
            onPress={handleOpenBatteryOptimization}
            activeOpacity={0.85}
          >
            <View style={styles.warningTopRow}>
              <View style={[styles.warningIconBadge, { backgroundColor: 'rgba(245, 158, 11, 0.15)' }]}>
                <Icon name="battery-dead-outline" size={22} color="#F59E0B" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.warningTitle, { color: '#F59E0B' }]}>Battery Optimization Restricting App</Text>
                <Text style={styles.warningSub}>
                  Set to "No restrictions" so background location never gets suspended.
                </Text>
              </View>
            </View>
            <View style={[styles.actionBtn, { backgroundColor: '#F59E0B' }]}>
              <Text style={styles.actionBtnText}>Disable Battery Restrictions</Text>
              <Icon name="arrow-forward" size={14} color="#fff" />
            </View>
          </TouchableOpacity>
        )}

        {/* Status indicators */}
        <View style={styles.statusList}>
          <StatusRow
            icon="location"
            label="Location sharing"
            active={!isHardwareLocOff && !isPermissionOff && !isServiceStopped}
            statusText={
              isHardwareLocOff
                ? 'Turned Off'
                : (isPermissionOff
                    ? 'No Permission'
                    : (isServiceStopped ? 'Paused' : 'Active'))
            }
            onFix={
              isHardwareLocOff
                ? openLocationSettings
                : (isPermissionOff
                    ? openAppSettings
                    : (isServiceStopped ? startLocationTracking : null))
            }
          />
          <StatusRow
            icon="shield"
            label="Background service"
            active={!isServiceStopped}
            statusText={isServiceStopped ? 'Stopped' : 'Running'}
            onFix={isServiceStopped ? startLocationTracking : null}
          />
          <StatusRow
            icon="battery-charging"
            label="Battery optimization"
            active={!isBatteryRestricted}
            statusText={isBatteryRestricted ? 'Restricted' : 'No Restrictions'}
            onFix={isBatteryRestricted ? handleOpenBatteryOptimization : null}
          />
          {serviceStatus.isOemWithKillSwitch && (
            <StatusRow
              icon="hardware-chip"
              label="Autostart settings"
              active={serviceStatus.autostartGranted !== false}
              statusText={serviceStatus.autostartGranted !== false ? 'Enabled' : 'Disabled'}
              onFix={serviceStatus.autostartGranted !== false ? null : handleOpenAutostart}
            />
          )}
          <StatusRow
            icon="lock-closed"
            label="Tamper guard"
            active={Boolean(tamperStatus?.hasMasterPin && tamperStatus?.isDeviceAdminActive && tamperStatus?.isAccessibilityEnabled)}
            statusText={
              (tamperStatus?.hasMasterPin && tamperStatus?.isDeviceAdminActive && tamperStatus?.isAccessibilityEnabled)
                ? 'Protected'
                : (tamperStatus?.hasMasterPin ? 'Setup Needed' : 'Not Set')
            }
            onFix={() => openProtectedAction('tamperGuard')}
          />
        </View>
      </View>


      {/* Top bar with Tamper Guard & Settings buttons */}
      <View style={styles.topBar}>
        <TouchableOpacity
          onPress={() => openProtectedAction('tamperGuard')}
          style={[styles.settingsBtn, { marginRight: 8 }]}
          activeOpacity={0.8}
        >
          <Icon
            name={
              (tamperStatus?.hasMasterPin && tamperStatus?.isDeviceAdminActive && tamperStatus?.isAccessibilityEnabled)
                ? 'shield-checkmark'
                : 'shield-outline'
            }
            size={20}
            color={
              (tamperStatus?.hasMasterPin && tamperStatus?.isDeviceAdminActive && tamperStatus?.isAccessibilityEnabled)
                ? '#10B981'
                : '#F59E0B'
            }
          />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => openProtectedAction('serverSettings')}
          style={styles.settingsBtn}
          activeOpacity={0.8}
        >
          <Icon name="settings-outline" size={20} color={Colors.text.secondary} />
        </TouchableOpacity>
      </View>

      {/* Bottom note */}
      <View style={styles.footer}>
        <Icon name="information-circle-outline" size={16} color={Colors.text.tertiary} />
        <Text style={styles.footerText}>
          CareTrack runs in the background to ensure safety. Keep Location and Background Services active.
        </Text>
      </View>

      {/* Server Settings Modal */}
      <ServerSettingsModal
        visible={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSave={async () => {
          await connectChildSocket();
          await startLocationTracking();
          await refreshStatus();
        }}
      />

      {/* Tamper Guard Modal */}
      <TamperGuardModal
        visible={tamperGuardOpen}
        onClose={() => {
          setTamperGuardOpen(false);
          refreshStatus();
        }}
        onStatusUpdated={(s) => setTamperStatus(s)}
      />
    </Animated.View>
  );
}

function StatusRow({ icon, label, active, statusText, onFix }) {
  return (
    <TouchableOpacity
      style={rowStyles.row}
      onPress={onFix}
      disabled={!onFix}
      activeOpacity={0.7}
    >
      <View style={[rowStyles.iconBox, active && rowStyles.iconBoxActive, !active && rowStyles.iconBoxError]}>
        <Icon
          name={icon}
          size={18}
          color={active ? Colors.brand.primary : (statusText === 'Turned Off' ? '#EF4444' : Colors.text.tertiary)}
        />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={rowStyles.label}>{label}</Text>
        {onFix && (
          <Text style={rowStyles.fixHint}>Tap to fix</Text>
        )}
      </View>
      <View style={[
        rowStyles.badge,
        {
          backgroundColor: active
            ? `${Colors.status.online}20`
            : (statusText === 'Turned Off' ? 'rgba(239, 68, 68, 0.15)' : Colors.bg.tertiary),
        },
      ]}>
        <View style={[
          rowStyles.dot,
          {
            backgroundColor: active
              ? Colors.status.online
              : (statusText === 'Turned Off' ? '#EF4444' : Colors.status.offline),
          },
        ]} />
        <Text style={[
          rowStyles.badgeText,
          {
            color: active
              ? Colors.status.online
              : (statusText === 'Turned Off' ? '#EF4444' : Colors.text.tertiary),
          },
        ]}>
          {statusText || (active ? 'Active' : 'Inactive')}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

const rowStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.bg.glassBorder },
  iconBox: { width: 38, height: 38, borderRadius: 12, backgroundColor: Colors.bg.tertiary, alignItems: 'center', justifyContent: 'center' },
  iconBoxActive: { backgroundColor: `${Colors.brand.primary}20` },
  iconBoxError: { backgroundColor: 'rgba(239, 68, 68, 0.15)' },
  label: { fontFamily: Fonts.medium, fontSize: Fonts.sizes.md, color: Colors.text.primary },
  fixHint: { fontFamily: Fonts.regular, fontSize: 11, color: Colors.brand.primary, marginTop: 1 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: Radius.full },
  dot: { width: 6, height: 6, borderRadius: 3 },
  badgeText: { fontFamily: Fonts.semiBold, fontSize: Fonts.sizes.xs },
});

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'space-between', paddingVertical: 32 },
  orb1: { position: 'absolute', top: -100, right: -80, width: 280, height: 280, borderRadius: 140, backgroundColor: `${Colors.brand.primary}12` },
  orb2: { position: 'absolute', bottom: -80, left: -60, width: 240, height: 240, borderRadius: 120, backgroundColor: `${Colors.brand.secondary}10` },

  shieldArea: { alignItems: 'center', justifyContent: 'center', marginTop: 20 },
  pulseRing: {
    position: 'absolute',
    width: 140, height: 140, borderRadius: 70,
    backgroundColor: `${Colors.brand.primary}15`,
    borderWidth: 1, borderColor: `${Colors.brand.primary}30`,
  },
  shieldCircle: {
    width: 108, height: 108, borderRadius: 36,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: Colors.brand.primary,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.5, shadowRadius: 24, elevation: 14,
  },

  content: {
    flex: 1, paddingHorizontal: Spacing.xxl, paddingTop: Spacing.xxl, width: '100%',
    alignItems: 'center',
  },
  title: { fontFamily: Fonts.bold, fontSize: Fonts.sizes.xxxl, color: Colors.text.primary, textAlign: 'center', marginBottom: 12 },
  subtitle: { fontFamily: Fonts.regular, fontSize: Fonts.sizes.md, color: Colors.text.secondary, textAlign: 'center', lineHeight: 24, marginBottom: Spacing.xxl },
  statusList: { width: '100%', backgroundColor: Colors.bg.secondary, borderRadius: Radius.xl, paddingHorizontal: Spacing.lg, borderWidth: 1, borderColor: Colors.bg.glassBorder },

  footer: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingHorizontal: Spacing.xxl },
  footerText: { fontFamily: Fonts.regular, fontSize: Fonts.sizes.xs, color: Colors.text.tertiary, lineHeight: 18, flex: 1 },

  pulseRingWarning: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderColor: 'rgba(239, 68, 68, 0.35)',
  },

  warningBanner: {
    width: '100%',
    backgroundColor: 'rgba(239, 68, 68, 0.10)',
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    borderColor: 'rgba(239, 68, 68, 0.45)',
    padding: Spacing.md,
    marginBottom: Spacing.lg,
  },
  warningTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 10,
  },
  warningIconBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(239, 68, 68, 0.20)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  warningTitle: {
    fontFamily: Fonts.bold,
    fontSize: Fonts.sizes.md,
    color: '#EF4444',
  },
  warningSub: {
    fontFamily: Fonts.regular,
    fontSize: Fonts.sizes.xs,
    color: Colors.text.secondary,
    lineHeight: 16,
    marginTop: 2,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#EF4444',
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: Radius.md,
    marginTop: 4,
  },
  actionBtnText: {
    fontFamily: Fonts.bold,
    fontSize: Fonts.sizes.sm,
    color: '#ffffff',
  },

  topBar: {
    position: 'absolute',
    top: 16,
    right: 20,
    zIndex: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  settingsBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
