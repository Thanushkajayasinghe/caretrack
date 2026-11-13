import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, Platform, Modal, KeyboardAvoidingView,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { Ionicons as Icon } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';
import { Fonts, Spacing, Radius } from '../theme/tokens';
import { GOOGLE_CONFIG, parseUrlParams } from '../services/googleAuth';

function GoogleLogo({ size = 20 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        fill="#4285F4"
        d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.8-2.4 3.65v3.03h3.88c2.27-2.09 3.66-5.17 3.66-9.12z"
      />
      <Path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.03c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.26v3.13C3.25 21.37 7.34 24 12 24z"
      />
      <Path
        fill="#FBBC05"
        d="M5.28 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.58H1.26C.46 8.17 0 9.97 0 12s.46 3.83 1.26 5.42l4.02-3.13z"
      />
      <Path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.34 0 3.25 2.63 1.26 6.58l4.02 3.13c.95-2.83 3.6-4.96 6.72-4.96z"
      />
    </Svg>
  );
}

// Mobile Chrome User-Agent allowing Google OAuth inside Android WebView
const MOBILE_CHROME_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.6613.127 Mobile Safari/537.36';

// JavaScript to ensure input elements are focused properly on Android touch
const INJECTED_INPUT_FOCUS_JS = `
  (function() {
    var meta = document.querySelector('meta[name="viewport"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'viewport';
      document.head.appendChild(meta);
    }
    meta.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no';

    document.addEventListener('touchstart', function(e) {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON' || e.target.tagName === 'TEXTAREA')) {
        e.target.focus();
      }
    }, { passive: true });
  })();
  true;
`;

export default function GoogleOAuthModal({
  visible,
  onSuccess,
  onError,
  onClose,
  onOpenInBrowser,
}) {
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0.1);
  const initialLoadDone = useRef(false);

  useEffect(() => {
    if (visible) {
      initialLoadDone.current = false;
      setLoading(true);
      setProgress(0.1);
    }
  }, [visible]);

  const handleDismiss = () => {
    if (onClose) onClose();
  };

  const clientId = GOOGLE_CONFIG.clientId;
  const redirectUri = GOOGLE_CONFIG.redirectUri;
  const state = Math.random().toString(36).substring(2, 15);
  const nonce = Math.random().toString(36).substring(2, 15);

  const authUrl =
    `https://accounts.google.com/o/oauth2/v2/auth?` +
    `client_id=${encodeURIComponent(clientId)}&` +
    `response_type=token%20id_token&` +
    `redirect_uri=${encodeURIComponent(redirectUri)}&` +
    `scope=${encodeURIComponent('openid email profile')}&` +
    `state=${encodeURIComponent(state)}&` +
    `nonce=${encodeURIComponent(nonce)}&` +
    `prompt=select_account`;

  const handleInterceptUrl = (url) => {
    if (!url) return false;

    // Intercept redirect when reached
    const isRedirect =
      url.startsWith('https://auth.expo.io') ||
      url.startsWith('https://caretrack') ||
      (redirectUri && url.startsWith(redirectUri));

    if (isRedirect) {
      const params = parseUrlParams(url);

      if (params.id_token || params.access_token) {
        if (onSuccess) {
          onSuccess({
            idToken: params.id_token,
            accessToken: params.access_token,
          });
        }
        return true;
      }

      if (params.error) {
        if (onError) {
          onError(params.error_description || params.error || 'Google login was cancelled.');
        }
        return true;
      }
    }
    return false;
  };

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="slide"
      statusBarTranslucent={true}
      onRequestClose={handleDismiss}
    >
      <View style={styles.modalBackdrop}>
        {/* Tap backdrop to dismiss */}
        <TouchableOpacity
          style={styles.backdropTapArea}
          activeOpacity={1}
          onPress={handleDismiss}
        />

        {/* In-App Sheet Container */}
        <View style={styles.sheetContainer}>
          {/* Header Bar */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <GoogleLogo size={22} />
              <Text style={styles.headerTitle}>Sign in with Google</Text>
            </View>

            <View style={styles.headerRight}>
              {onOpenInBrowser && (
                <TouchableOpacity
                  onPress={onOpenInBrowser}
                  style={styles.browserBtn}
                  activeOpacity={0.7}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Icon name="open-outline" size={14} color="#60A5FA" />
                  <Text style={styles.browserBtnText}>Use Chrome</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                onPress={handleDismiss}
                style={styles.closeBtn}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Icon name="close" size={20} color="#94A3B8" />
              </TouchableOpacity>
            </View>
          </View>

          {/* Top Progress Bar */}
          {loading && (
            <View style={styles.progressBarTrack}>
              <View
                style={[
                  styles.progressBarFill,
                  { width: `${Math.min(Math.max(Math.round(progress * 100), 20), 100)}%` },
                ]}
              />
            </View>
          )}

          {/* Embedded In-App Browser WebView */}
          <View style={styles.webViewWrapper}>
            <WebView
              source={{ uri: authUrl }}
              userAgent={MOBILE_CHROME_USER_AGENT}
              style={styles.webView}
              javaScriptEnabled={true}
              domStorageEnabled={true}
              thirdPartyCookiesEnabled={true}
              sharedCookiesEnabled={true}
              originWhitelist={['*']}
              nestedScrollEnabled={true}
              keyboardDisplayRequiresUserAction={false}
              injectedJavaScript={INJECTED_INPUT_FOCUS_JS}
              onLoadStart={() => {
                if (!initialLoadDone.current) {
                  setLoading(true);
                }
              }}
              onLoadProgress={({ nativeEvent }) => {
                setProgress(nativeEvent.progress);
                if (nativeEvent.progress >= 0.5) {
                  initialLoadDone.current = true;
                  setLoading(false);
                }
              }}
              onLoadEnd={() => {
                initialLoadDone.current = true;
                setLoading(false);
              }}
              onNavigationStateChange={(navState) => {
                handleInterceptUrl(navState.url);
              }}
              onError={(syntheticEvent) => {
                const { nativeEvent } = syntheticEvent;
                console.warn('Google WebView error:', nativeEvent);
                setLoading(false);
              }}
              onHttpError={(syntheticEvent) => {
                const { nativeEvent } = syntheticEvent;
                console.warn('Google WebView HTTP error:', nativeEvent);
                setLoading(false);
              }}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(5, 7, 14, 0.75)',
    justifyContent: 'flex-end',
  },
  backdropTapArea: {
    flex: 1,
  },
  sheetContainer: {
    width: '100%',
    height: '88%',
    backgroundColor: '#0D1324',
    borderTopLeftRadius: Radius.xxl,
    borderTopRightRadius: Radius.xxl,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
    backgroundColor: '#111827',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontFamily: Fonts.semiBold,
    fontSize: 15,
    color: '#F8FAFC',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  browserBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Radius.md,
    backgroundColor: 'rgba(96, 165, 250, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(96, 165, 250, 0.3)',
  },
  browserBtnText: {
    fontFamily: Fonts.medium,
    fontSize: 12,
    color: '#93C5FD',
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressBarTrack: {
    height: 3,
    width: '100%',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    overflow: 'hidden',
  },
  progressBarFill: {
    height: 3,
    backgroundColor: '#4285F4',
  },
  webViewWrapper: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  webView: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
});
