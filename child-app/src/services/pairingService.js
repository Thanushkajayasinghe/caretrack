import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import { getBaseUrl } from '../config/server';

/**
 * Generate a persistent hardware/app-bound device fingerprint.
 */
async function getDeviceFingerprint() {
  let fp = await AsyncStorage.getItem('deviceFingerprint');
  if (!fp) {
    fp = 'child-' + Platform.OS + '-' + Math.random().toString(36).substring(2, 15) + '-' + Date.now();
    await AsyncStorage.setItem('deviceFingerprint', fp);
  }
  return fp;
}

/**
 * Claim a pairing session and store the device token.
 */
export async function pairDevice(sessionIdOrOtp, optionalOtp) {
  let sessionId = null;
  let otp = null;

  if (optionalOtp) {
    sessionId = sessionIdOrOtp;
    otp = optionalOtp;
  } else {
    otp = sessionIdOrOtp;
  }

  const fingerprint = await getDeviceFingerprint();
  const deviceName = Platform.OS === 'android' ? 'Android Child Device' : 'iOS Child Device';
  const androidVersion = String(Platform.Version || '15');

  const payload = {
    otp,
    deviceFingerprint: fingerprint,
    deviceName,
    androidVersion,
  };
  const targetUrl = `${getBaseUrl()}/pair/claim`;
  try {
    const { data } = await axios.post(targetUrl, payload, { timeout: 12000 });

    // Securely store credentials
    await AsyncStorage.multiSet([
      ['deviceToken', data.deviceToken],
      ['deviceFingerprint', fingerprint],
      ['childId', data.childId],
      ['parentId', data.parentId],
      ['deviceId', data.deviceId],
      ['paired', 'true'],
    ]);

    return data;
  } catch (err) {
    if (!err.response) {
      throw new Error(`Cannot reach server at ${targetUrl}. Tap ⚙️ settings to confirm PC Wi-Fi IP.`);
    }
    throw err;
  }
}
