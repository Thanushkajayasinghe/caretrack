import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Alert,
  ActivityIndicator, Dimensions, Animated, TextInput,
  KeyboardAvoidingView, ScrollView, Platform,
} from 'react-native';
import { Camera, useCameraDevice, useCodeScanner } from 'react-native-vision-camera';
import AsyncStorage from '@react-native-async-storage/async-storage';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/Ionicons';
import { Colors, Fonts, Spacing, Radius } from '../../theme/tokens';
import { pairDevice } from '../../services/pairingService';
import { setServerConfig } from '../../config/server';
import ServerSettingsModal from '../Settings/ServerSettingsModal';

const { width, height } = Dimensions.get('window');

export default function PairScanScreen({ navigation, onPaired }) {
  const [scanning, setScanning] = useState(true);
  const [loading, setLoading] = useState(false);
  const [hasPermission, setHasPermission] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [mode, setMode] = useState('manual'); // 'qr' | 'manual' (defaults to manual for emulator)
  const [settingsOpen, setSettingsOpen] = useState(false);
  const scanLineAnim = new Animated.Value(0);

  const device = useCameraDevice('back');

  useEffect(() => {
    Camera.requestCameraPermission().then((status) => {
      setHasPermission(status === 'granted');
    });

    // Animate scan line
    Animated.loop(
      Animated.sequence([
        Animated.timing(scanLineAnim, { toValue: 1, duration: 2000, useNativeDriver: true }),
        Animated.timing(scanLineAnim, { toValue: 0, duration: 2000, useNativeDriver: true }),
      ]),
    ).start();
  }, []);

  const codeScanner = useCodeScanner({
    codeTypes: ['qr'],
    onCodeScanned: async (codes) => {
      if (!scanning || loading) return;
      const code = codes[0];
      if (!code?.value) return;

      setScanning(false);
      await handleQRPayload(code.value);
    },
  });

  const handleQRPayload = async (payload) => {
    // Parse: caretrack://pair?session=<id>&code=<otp>&server=<url>
    try {
      const url = new URL(payload);
      if (url.protocol !== 'caretrack:') throw new Error('Invalid QR');
      const sessionId = url.searchParams.get('session');
      const otp = url.searchParams.get('code');
      const serverParam = url.searchParams.get('server');

      if (serverParam) {
        const decoded = decodeURIComponent(serverParam);
        console.log('✅ Auto-configured server from QR:', decoded);
        await setServerConfig(decoded);
      }

      if (!sessionId || !otp) throw new Error('Missing pairing data');
      await claimSession(sessionId, otp);
    } catch (err) {
      console.warn('QR parse error:', err);
      Alert.alert('Invalid QR', 'This QR code is not from CareTrack. Please try again.', [
        { text: 'Retry', onPress: () => setScanning(true) },
      ]);
    }
  };

  const claimSession = async (sessionId, otp) => {
    setLoading(true);
    try {
      await pairDevice(sessionId, otp);
      onPaired();
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Pairing failed. The code may have expired.';
      Alert.alert('Pairing Failed', msg, [
        { text: 'Try Again', onPress: () => { setScanning(true); setLoading(false); } },
      ]);
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <LinearGradient colors={['#0A0E1A', '#111827']} style={StyleSheet.absoluteFill} />
        <ActivityIndicator size="large" color={Colors.brand.primary} />
        <Text style={styles.loadingText}>Pairing device...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {hasPermission && device && mode === 'qr' ? (
        <>
          <Camera
            style={StyleSheet.absoluteFill}
            device={device}
            isActive={scanning}
            codeScanner={codeScanner}
          />
          {/* Dark overlay with scan window */}
          <View style={styles.overlay}>
            <View style={styles.overlayTop} />
            <View style={styles.overlayMiddle}>
              <View style={styles.overlaySide} />
              <View style={styles.scanWindow}>
                {/* Corner brackets */}
                {['tl', 'tr', 'bl', 'br'].map((pos) => (
                  <View key={pos} style={[styles.corner, styles[`corner_${pos}`]]} />
                ))}
                {/* Scan line */}
                <Animated.View
                  style={[
                    styles.scanLine,
                    {
                      transform: [{
                        translateY: scanLineAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0, width * 0.65 - 4],
                        }),
                      }],
                    },
                  ]}
                />
              </View>
              <View style={styles.overlaySide} />
            </View>
            <View style={styles.overlayBottom}>
              <Text style={styles.scanHint}>Point camera at QR code on parent's phone</Text>
              <TouchableOpacity style={styles.manualBtn} onPress={() => setMode('manual')} activeOpacity={0.8}>
                <Text style={styles.manualBtnText}>Enter code manually</Text>
              </TouchableOpacity>
            </View>
          </View>
        </>
      ) : (
        <ManualCodeEntry
          onSubmit={(otp) => claimSession(null, otp)}
          onBack={() => setMode('qr')}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      )}

      {/* Settings Modal */}
      <ServerSettingsModal
        visible={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </View>
  );
}

function ManualCodeEntry({ onSubmit, onBack, onOpenSettings }) {
  const [code, setCode] = React.useState('');
  const inputRef = React.useRef(null);

  const handleTextChange = (text) => {
    const cleaned = text.replace(/[^0-9]/g, '').slice(0, 6);
    setCode(cleaned);
    if (cleaned.length === 6) {
      onSubmit(cleaned);
    }
  };

  return (
    <View style={manualStyles.container}>
      <LinearGradient colors={['#0A0E1A', '#111827']} style={StyleSheet.absoluteFill} />
      <TouchableOpacity onPress={onBack} style={manualStyles.back}>
        <Icon name="arrow-back" size={22} color={Colors.text.secondary} />
      </TouchableOpacity>

      <TouchableOpacity onPress={onOpenSettings} style={manualStyles.settingsBtn}>
        <Icon name="settings-outline" size={22} color={Colors.brand.primary} />
      </TouchableOpacity>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1, width: '100%' }}
      >
        <ScrollView
          contentContainerStyle={manualStyles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={manualStyles.title}>Enter Pairing Code</Text>
          <Text style={manualStyles.sub}>Type the 6-digit PIN shown on the parent's screen</Text>

          <TouchableOpacity
            activeOpacity={1}
            onPress={() => inputRef.current?.focus()}
            style={manualStyles.digitRowTouchable}
          >
            <View style={manualStyles.digitRow}>
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <View key={i} style={[manualStyles.digitBox, code.length === i && manualStyles.digitBoxActive]}>
                  <Text style={manualStyles.digitText}>{code[i] || ''}</Text>
                </View>
              ))}
            </View>

            <TextInput
              ref={inputRef}
              style={manualStyles.hiddenInput}
              value={code}
              onChangeText={handleTextChange}
              keyboardType="number-pad"
              maxLength={6}
              autoFocus={true}
            />
          </TouchableOpacity>

          <TouchableOpacity
            style={[manualStyles.submitBtn, code.length < 6 && { opacity: 0.5 }]}
            disabled={code.length < 6}
            onPress={() => onSubmit(code)}
            activeOpacity={0.85}
          >
            <LinearGradient
              colors={[Colors.brand.primary, '#8B5CF6']}
              style={manualStyles.submitBtnGrad}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
            >
              <Text style={manualStyles.submitBtnText}>Connect to Parent</Text>
            </LinearGradient>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const manualStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0E1A',
  },
  scrollContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingTop: 80,
    paddingBottom: 40,
    width: '100%',
  },
  back: {
    position: 'absolute',
    top: 52,
    left: 16,
    width: 44,
    height: 44,
    justifyContent: 'center',
    zIndex: 10,
  },
  settingsBtn: {
    position: 'absolute',
    top: 52,
    right: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(108, 99, 255, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(108, 99, 255, 0.3)',
    zIndex: 10,
  },
  title: {
    fontFamily: Fonts.bold,
    fontSize: Fonts.sizes.xxl,
    color: Colors.text.primary,
    marginBottom: 8,
    textAlign: 'center',
  },
  sub: {
    fontFamily: Fonts.regular,
    fontSize: Fonts.sizes.sm,
    color: Colors.text.secondary,
    textAlign: 'center',
    marginBottom: 32,
    paddingHorizontal: 10,
  },
  digitRowTouchable: {
    width: '100%',
    maxWidth: 360,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  digitRow: {
    flexDirection: 'row',
    width: '100%',
    justifyContent: 'center',
    gap: 8,
  },
  digitBox: {
    flex: 1,
    maxWidth: 48,
    height: 58,
    borderRadius: Radius.md,
    backgroundColor: Colors.bg.secondary,
    borderWidth: 1.5,
    borderColor: `${Colors.brand.primary}50`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  digitBoxActive: {
    borderColor: Colors.brand.primary,
    backgroundColor: `${Colors.brand.primary}20`,
  },
  digitText: {
    fontFamily: Fonts.bold,
    fontSize: 22,
    color: Colors.brand.primary,
  },
  hiddenInput: {
    position: 'absolute',
    opacity: 0.01,
    width: '100%',
    height: '100%',
    top: 0,
    left: 0,
  },
  submitBtn: {
    width: '100%',
    maxWidth: 360,
    marginTop: 16,
  },
  submitBtnGrad: {
    height: 52,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitBtnText: {
    fontFamily: Fonts.semiBold,
    fontSize: Fonts.sizes.md,
    color: '#fff',
  },
  note: {
    fontFamily: Fonts.regular,
    fontSize: Fonts.sizes.sm,
    color: Colors.text.tertiary,
    textAlign: 'center',
    lineHeight: 22,
  },
});

const SCAN_SIZE = width * 0.65;
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 20 },
  loadingText: { fontFamily: Fonts.medium, fontSize: Fonts.sizes.lg, color: Colors.text.primary },
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center' },
  overlayTop: { flex: 1, width: '100%', backgroundColor: 'rgba(0,0,0,0.7)' },
  overlayMiddle: { flexDirection: 'row', height: SCAN_SIZE },
  overlaySide: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)' },
  scanWindow: { width: SCAN_SIZE, height: SCAN_SIZE, position: 'relative' },
  corner: { position: 'absolute', width: 24, height: 24, borderColor: Colors.brand.primary, borderWidth: 3 },
  corner_tl: { top: 0, left: 0, borderRightWidth: 0, borderBottomWidth: 0, borderTopLeftRadius: 4 },
  corner_tr: { top: 0, right: 0, borderLeftWidth: 0, borderBottomWidth: 0, borderTopRightRadius: 4 },
  corner_bl: { bottom: 0, left: 0, borderRightWidth: 0, borderTopWidth: 0, borderBottomLeftRadius: 4 },
  corner_br: { bottom: 0, right: 0, borderLeftWidth: 0, borderTopWidth: 0, borderBottomRightRadius: 4 },
  scanLine: { position: 'absolute', left: 4, right: 4, height: 2, backgroundColor: Colors.brand.primary, shadowColor: Colors.brand.primary, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.8, shadowRadius: 4, elevation: 4 },
  overlayBottom: { flex: 1, width: '100%', backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', paddingTop: 32, gap: 20 },
  scanHint: { fontFamily: Fonts.medium, fontSize: Fonts.sizes.md, color: Colors.text.secondary, textAlign: 'center', paddingHorizontal: 40 },
  manualBtn: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.brand.primary, backgroundColor: `${Colors.brand.primary}15` },
  manualBtnText: { fontFamily: Fonts.semiBold, fontSize: Fonts.sizes.sm, color: Colors.brand.primary },
});
