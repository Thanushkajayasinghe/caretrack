import { NativeModules, PermissionsAndroid, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import axios from 'axios';
import { getPendingPoints, markSynced, clearSynced } from './offlineQueue';
import { getServerConfig, getBaseUrl, getServerUrl } from '../config/server';

const { CareTrackLocationModule } = NativeModules;
let isSyncing = false;

/**
 * Request all necessary permissions on Android
 */
export async function requestLocationPermissions() {
  if (Platform.OS !== 'android') return true;

  try {
    const permissions = [
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      PermissionsAndroid.PERMISSIONS.READ_CALL_LOG,
      PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE,
    ];

    if (Platform.Version >= 29) {
      permissions.push(PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION);
    }

    if (Platform.Version >= 33) {
      permissions.push(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
    }

    const granted = await PermissionsAndroid.requestMultiple(permissions);

    const fineOk = granted[PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION] === PermissionsAndroid.RESULTS.GRANTED;
    const coarseOk = granted[PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION] === PermissionsAndroid.RESULTS.GRANTED;

    // Optional background location prompt on Android 10+
    if (fineOk && Platform.Version >= 29) {
      try {
        await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_BACKGROUND_LOCATION);
      } catch (_e) {}
    }

    return fineOk || coarseOk;
  } catch (err) {
    console.warn('Error requesting permissions:', err);
    return false;
  }
}

/**
 * Configure and start the native background location foreground service.
 */
export async function startLocationTracking() {
  const deviceToken = await AsyncStorage.getItem('deviceToken');
  const deviceFingerprint = await AsyncStorage.getItem('deviceFingerprint');
  if (!deviceToken || !deviceFingerprint) {
    console.warn('Cannot start tracking — device not paired');
    return;
  }

  // Ensure runtime permissions are granted
  await requestLocationPermissions();

  const cfg = getServerConfig();
  const serverTarget = getServerUrl();

  // Start native sticky Foreground Service
  if (CareTrackLocationModule?.startBackgroundService) {
    try {
      await CareTrackLocationModule.startBackgroundService(
        deviceToken,
        deviceFingerprint,
        serverTarget,
        cfg?.port || 5000
      );
      console.log('✅ CareTrack Native Background Location Service started with server:', serverTarget);
    } catch (err) {
      console.error('Failed to start native background service:', err);
    }
  }

  // Network listener to flush offline queue
  NetInfo.addEventListener((state) => {
    if (state.isConnected) {
      flushOfflineQueue(deviceToken, deviceFingerprint);
    }
  });
}

export async function stopLocationTracking() {
  if (CareTrackLocationModule?.stopBackgroundService) {
    await CareTrackLocationModule.stopBackgroundService();
    console.log('⏹ Native background service stopped');
  }
}

export async function checkServicesStatus() {
  if (CareTrackLocationModule?.checkServicesStatus) {
    try {
      const status = await CareTrackLocationModule.checkServicesStatus();
      return status;
    } catch (e) {
      console.warn('checkServicesStatus error:', e);
    }
  }
  return {
    locationEnabled: false,
    masterLocationEnabled: false,
    gpsEnabled: false,
    hardwareLocationEnabled: false,
    permissionGranted: false,
    serviceRunning: false,
    batteryOptimizationIgnored: false,
  };
}

export async function openLocationSettings() {
  if (CareTrackLocationModule?.openLocationSettings) {
    try {
      await CareTrackLocationModule.openLocationSettings();
    } catch (e) {
      console.warn('openLocationSettings error:', e);
    }
  }
}

export async function openBatteryOptimizationSettings() {
  if (CareTrackLocationModule?.openBatteryOptimizationSettings) {
    try {
      await CareTrackLocationModule.openBatteryOptimizationSettings();
    } catch (e) {
      console.warn('openBatteryOptimizationSettings error:', e);
    }
  }
}

export async function openAutostartSettings() {
  if (CareTrackLocationModule?.openAutostartSettings) {
    try {
      await CareTrackLocationModule.openAutostartSettings();
    } catch (e) {
      console.warn('openAutostartSettings error:', e);
    }
  }
}

export async function openAppSettings() {
  if (CareTrackLocationModule?.openAppSettings) {
    try {
      await CareTrackLocationModule.openAppSettings();
    } catch (e) {
      console.warn('openAppSettings error:', e);
    }
  }
}

export async function getTamperGuardStatus() {
  if (CareTrackLocationModule?.getTamperGuardStatus) {
    try {
      return await CareTrackLocationModule.getTamperGuardStatus();
    } catch (e) {
      console.warn('getTamperGuardStatus error:', e);
    }
  }
  return {
    isDeviceAdminActive: false,
    isAccessibilityEnabled: false,
    canDrawOverlays: false,
    hasMasterPin: false,
    isMaintenanceActive: false,
  };
}

export async function setMasterPin(pin) {
  if (CareTrackLocationModule?.setMasterPin) {
    return await CareTrackLocationModule.setMasterPin(pin);
  }
  return false;
}

export async function verifyMasterPin(pin) {
  if (CareTrackLocationModule?.verifyMasterPin) {
    return await CareTrackLocationModule.verifyMasterPin(pin);
  }
  return false;
}

export async function requestDeviceAdmin() {
  if (CareTrackLocationModule?.requestDeviceAdmin) {
    return await CareTrackLocationModule.requestDeviceAdmin();
  }
}

export async function openAccessibilitySettings() {
  if (CareTrackLocationModule?.openAccessibilitySettings) {
    return await CareTrackLocationModule.openAccessibilitySettings();
  }
}

export async function requestOverlayPermission() {
  if (CareTrackLocationModule?.requestOverlayPermission) {
    return await CareTrackLocationModule.requestOverlayPermission();
  }
}

export async function unlockMaintenanceMode(pin) {
  if (CareTrackLocationModule?.unlockMaintenanceMode) {
    return await CareTrackLocationModule.unlockMaintenanceMode(pin);
  }
  return false;
}

export async function lockNow() {
  if (CareTrackLocationModule?.lockNow) {
    return await CareTrackLocationModule.lockNow();
  }
  return false;
}


/**
 * Flush any unsynced location points from SQLite to the backend.
 */
export async function flushOfflineQueue(deviceToken, deviceFingerprint) {
  if (isSyncing) return;
  isSyncing = true;
  try {
    const pending = await getPendingPoints(300);
    if (pending.length === 0) return;

    const points = pending.map((p) => ({
      lat: p.lat,
      lng: p.lng,
      accuracy: p.accuracy,
      speed: p.speed,
      heading: p.heading,
      altitude: p.altitude,
      batteryLevel: p.battery_level,
      isCharging: Boolean(p.is_charging),
      recordedAt: p.recorded_at,
    }));

    await axios.post(`${getBaseUrl()}/location/batch`, { points }, {
      headers: {
        Authorization: `Bearer ${deviceToken}`,
        'X-Device-Fingerprint': deviceFingerprint,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    });

    const ids = pending.map((p) => p.id);
    await markSynced(ids);
    await clearSynced();
    console.log(`✅ Flushed ${pending.length} offline points`);
  } catch (err) {
    console.warn('Flush failed (will retry):', err.message);
  } finally {
    isSyncing = false;
  }
}

/**
 * Record surroundings audio snapshot using native MediaRecorder
 */
export async function recordAudioSnapshot(durationSeconds = 20, requestId = `req_${Date.now()}`) {
  if (CareTrackLocationModule?.recordAudioSnapshot) {
    return await CareTrackLocationModule.recordAudioSnapshot(durationSeconds, requestId);
  }
  throw new Error('CareTrackLocationModule.recordAudioSnapshot is not available');
}

/**
 * Capture full screen snapshot silently using native Accessibility Service (Android 11+)
 */
export async function captureScreenshot(requestId = `req_${Date.now()}`) {
  if (CareTrackLocationModule?.captureScreenshot) {
    return await CareTrackLocationModule.captureScreenshot(requestId);
  }
  throw new Error('CareTrackLocationModule.captureScreenshot is not available');
}

/**
 * Start live real-time audio stream via native CareTrackLocationService
 */
export async function startLiveAudioStream(requestId = `live_${Date.now()}`) {
  if (CareTrackLocationModule?.startLiveAudioStream) {
    return await CareTrackLocationModule.startLiveAudioStream(requestId);
  }
  throw new Error('CareTrackLocationModule.startLiveAudioStream is not available');
}

/**
 * Stop live real-time audio stream
 */
export async function stopLiveAudioStream() {
  if (CareTrackLocationModule?.stopLiveAudioStream) {
    return await CareTrackLocationModule.stopLiveAudioStream();
  }
}

/**
 * Upload captured snapshot (audio, screenshot, camera) to backend
 */
export async function uploadSnapshot({ mediaType = 'audio', mediaBase64, durationSeconds, requestId, latitude, longitude }) {
  const deviceToken = await AsyncStorage.getItem('deviceToken');
  const deviceFingerprint = await AsyncStorage.getItem('deviceFingerprint');
  if (!deviceToken || !deviceFingerprint) {
    throw new Error('Device not paired');
  }

  const targetUrl = `${getBaseUrl()}/snapshots/upload`;
  const response = await axios.post(
    targetUrl,
    {
      mediaType,
      mediaBase64,
      durationSeconds,
      requestId,
      latitude,
      longitude,
      recordedAt: new Date().toISOString(),
    },
    {
      headers: {
        Authorization: `Bearer ${deviceToken}`,
        'X-Device-Fingerprint': deviceFingerprint,
      },
      timeout: 30000,
    }
  );
  return response.data;
}

/**
 * Explicitly request Call Log runtime permissions
 */
export async function requestCallLogPermission() {
  if (Platform.OS !== 'android') return true;
  try {
    const granted = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.READ_CALL_LOG,
      PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE,
    ]);
    return granted[PermissionsAndroid.PERMISSIONS.READ_CALL_LOG] === PermissionsAndroid.RESULTS.GRANTED;
  } catch (err) {
    console.warn('Error requesting call log permission:', err);
    return false;
  }
}

/**
 * Retrieve local call log records from native bridge
 */
export async function getCallLogs(limit = 100) {
  if (CareTrackLocationModule?.getCallLogs) {
    try {
      return await CareTrackLocationModule.getCallLogs(limit);
    } catch (e) {
      console.warn('getCallLogs error:', e);
    }
  }
  return [];
}

/**
 * Trigger immediate background call log sync to backend
 */
export async function syncCallLogs() {
  if (CareTrackLocationModule?.syncCallLogs) {
    try {
      return await CareTrackLocationModule.syncCallLogs();
    } catch (e) {
      console.warn('syncCallLogs error:', e);
    }
  }
  return false;
}

