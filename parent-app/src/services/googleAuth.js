import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { authAPI } from './api';

WebBrowser.maybeCompleteAuthSession();

// Google OAuth Client Configuration
// Uses the direct CareTrack backend callback relay — bypassing auth.expo.io entirely
export const GOOGLE_CONFIG = {
  clientId:
    process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID ||
    '813677361985-354al4jvnfvl4ouc755ipbuvlkloabf2.apps.googleusercontent.com',
  redirectUri: 'https://caretrack-backend-kv2n.onrender.com/api/auth/google/callback',
};

/**
 * Handle successful Google login response by exchanging credentials with backend
 */
export async function authenticateWithBackend(googlePayload) {
  const { data } = await authAPI.googleAuth(googlePayload);

  // Store auth tokens and user data in local storage
  await AsyncStorage.multiSet([
    ['accessToken', data.accessToken],
    ['refreshToken', data.refreshToken],
    ['parentId', data.parent.id],
    ['parentName', data.parent.name || ''],
    ['parentEmail', data.parent.email || ''],
    ['parentPhone', data.parent.phone || ''],
    ['authProvider', data.parent.auth_provider || 'google'],
  ]);

  return {
    parent: data.parent,
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    isProfileComplete: data.isProfileComplete,
  };
}

/**
 * Robust URL parameter parser: extracts both query and fragment/hash params
 */
export function parseUrlParams(url) {
  const params = {};
  if (!url) return params;

  const queryPart = url.includes('?') ? url.split('?')[1].split('#')[0] : '';
  const hashPart = url.includes('#') ? url.split('#')[1] : '';

  const parseString = (str) => {
    if (!str) return;
    str.split('&').forEach((part) => {
      const [key, value] = part.split('=');
      if (key && value) {
        try {
          params[decodeURIComponent(key)] = decodeURIComponent(value);
        } catch (_e) {
          params[key] = value;
        }
      }
    });
  };

  parseString(queryPart);
  parseString(hashPart);

  return params;
}

/**
 * Perform Google Sign-In: opens the official Google Account Selector web page directly
 * Zero auth.expo.io proxy, zero interstitial prompt, direct callback relay
 */
export async function promptGoogleSignIn() {
  const clientId = GOOGLE_CONFIG.clientId;
  const redirectUri = GOOGLE_CONFIG.redirectUri;

  // The local app return deep-link URL (works for both Expo Go and standalone APK)
  const returnUrl = Linking.createURL('google-auth-callback');
  const nonce = Math.random().toString(36).substring(2, 15);

  // Pass returnUrl in OAuth 'state' parameter so backend callback can relay tokens directly back
  const authUrl =
    `https://accounts.google.com/o/oauth2/v2/auth?` +
    `client_id=${encodeURIComponent(clientId)}&` +
    `response_type=token%20id_token&` +
    `redirect_uri=${encodeURIComponent(redirectUri)}&` +
    `scope=${encodeURIComponent('openid email profile')}&` +
    `state=${encodeURIComponent(returnUrl)}&` +
    `nonce=${encodeURIComponent(nonce)}&` +
    `prompt=select_account`;

  // Backup listener to capture deep link params even if WebBrowser dismisses early on Android
  let capturedRedirectUrl = null;
  const urlSub = Linking.addEventListener('url', (event) => {
    if (event?.url && (event.url.includes('id_token') || event.url.includes('access_token') || event.url.includes('error='))) {
      capturedRedirectUrl = event.url;
    }
  });

  try {
    const result = await WebBrowser.openAuthSessionAsync(authUrl, returnUrl, {
      showInRecents: false,
      createTask: false,
      useProxyActivity: false,
      toolbarColor: '#0D1324',
      secondaryToolbarColor: '#111827',
      browserPackage: 'com.android.chrome',
    });

    let finalUrl = (result.type === 'success' && result.url) ? result.url : capturedRedirectUrl;

    if (!finalUrl && (result.type === 'dismiss' || result.type === 'cancel')) {
      const initUrl = await Linking.getInitialURL();
      if (initUrl && (initUrl.includes('id_token') || initUrl.includes('access_token'))) {
        finalUrl = initUrl;
      } else {
        await new Promise((r) => setTimeout(r, 600));
        finalUrl = capturedRedirectUrl;
      }
    }

    if (finalUrl) {
      const params = parseUrlParams(finalUrl);

      if (params.id_token || params.access_token) {
        return await authenticateWithBackend({
          idToken: params.id_token,
          accessToken: params.access_token,
        });
      }

      if (params.error) {
        throw new Error(params.error_description || params.error || 'Google login was denied.');
      }
    }

    return { cancelled: true };
  } catch (err) {
    console.error('Google Sign-In Error:', err);
    throw err;
  } finally {
    urlSub.remove();
  }
}
