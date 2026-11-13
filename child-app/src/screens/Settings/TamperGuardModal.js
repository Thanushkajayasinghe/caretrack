import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, Modal, TouchableOpacity, TextInput,
  ScrollView, Alert, ActivityIndicator,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/Ionicons';
import { Colors, Fonts, Spacing, Radius } from '../../theme/tokens';
import {
  getTamperGuardStatus,
  setMasterPin,
  verifyMasterPin,
  requestDeviceAdmin,
  openAccessibilitySettings,
  requestOverlayPermission,
  unlockMaintenanceMode,
  lockNow,
} from '../../services/locationService';

export default function TamperGuardModal({ visible, onClose, onStatusUpdated }) {
  const [status, setStatus] = useState({
    isDeviceAdminActive: false,
    isAccessibilityEnabled: false,
    canDrawOverlays: false,
    hasMasterPin: false,
    isMaintenanceActive: false,
  });

  const [loading, setLoading] = useState(false);
  const [currentPin, setCurrentPin] = useState('');
  const [pinInput, setPinInput] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [showPinSetup, setShowPinSetup] = useState(false);

  const fetchStatus = async () => {
    try {
      const s = await getTamperGuardStatus();
      if (s) {
        setStatus(s);
        if (onStatusUpdated) onStatusUpdated(s);
      }
    } catch (e) {
      console.warn('TamperGuard fetch error:', e);
    }
  };

  useEffect(() => {
    if (visible) {
      fetchStatus();
      const interval = setInterval(fetchStatus, 2000);
      return () => clearInterval(interval);
    }
  }, [visible]);

  const handleSavePin = async () => {
    if (status.hasMasterPin) {
      if (currentPin.length < 4) {
        Alert.alert('Current PIN Required', 'Please enter your current 4-digit Master PIN.');
        return;
      }
      try {
        const isCurrentValid = await verifyMasterPin(currentPin);
        if (!isCurrentValid) {
          Alert.alert('Incorrect PIN', 'The current Master PIN you entered is incorrect.');
          return;
        }
      } catch (_e) {
        Alert.alert('Verification Error', 'Failed to verify current PIN.');
        return;
      }
    }

    if (pinInput.length < 4) {
      Alert.alert('Invalid PIN', 'New Master PIN must be at least 4 digits.');
      return;
    }
    if (pinInput !== pinConfirm) {
      Alert.alert('PIN Mismatch', 'The entered new PINs do not match.');
      return;
    }

    setLoading(true);
    try {
      const ok = await setMasterPin(pinInput);
      if (ok) {
        await unlockMaintenanceMode(pinInput).catch(() => {});
        Alert.alert('Success', 'Parent Master PIN successfully saved! You can now configure the protection steps below.');
        setCurrentPin('');
        setPinInput('');
        setPinConfirm('');
        setShowPinSetup(false);
        fetchStatus();
      } else {
        Alert.alert('Error', 'Failed to save Master PIN.');
      }
    } catch (e) {
      Alert.alert('Error', e.message || 'Failed to save PIN.');
    } finally {
      setLoading(false);
    }
  };

  const handleRequestAdmin = async () => {
    try {
      await requestDeviceAdmin();
    } catch (_e) {}
  };

  const handleOpenAccessibility = async () => {
    try {
      await openAccessibilitySettings();
    } catch (_e) {}
  };

  const handleRequestOverlay = async () => {
    try {
      await requestOverlayPermission();
    } catch (_e) {}
  };

  const handleClose = async () => {
    try {
      await lockNow();
    } catch (_e) {}
    onClose();
  };

  const isAllProtected = status.hasMasterPin && status.isDeviceAdminActive && status.isAccessibilityEnabled;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
    >
      <View style={styles.backdrop}>
        <View style={styles.modalCard}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerTitleRow}>
              <View style={[styles.shieldIconBox, isAllProtected ? styles.shieldOk : styles.shieldWarn]}>
                <Icon name={isAllProtected ? 'shield-checkmark' : 'shield-half'} size={20} color="#fff" />
              </View>
              <View>
                <Text style={styles.title}>Tamper Guard</Text>
                <Text style={styles.subtitle}>Uninstall & Force-Stop Protection</Text>
              </View>
            </View>
            <TouchableOpacity onPress={handleClose} style={styles.closeBtn}>
              <Icon name="close" size={20} color={Colors.text.tertiary} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
            {/* Status Summary Banner */}
            <View style={[styles.banner, isAllProtected ? styles.bannerOk : styles.bannerWarn]}>
              <Icon
                name={isAllProtected ? 'checkmark-circle' : 'alert-circle'}
                size={20}
                color={isAllProtected ? '#10B981' : '#F59E0B'}
              />
              <Text style={styles.bannerText}>
                {isAllProtected
                  ? 'All protection layers are ACTIVE. The child cannot uninstall or force-close CareTrack.'
                  : 'Follow the 3 steps below to lock CareTrack against tampering.'}
              </Text>
            </View>

            {/* Step 1: Master PIN */}
            <View style={styles.sectionCard}>
              <View style={styles.stepHeader}>
                <View style={[styles.stepNumber, status.hasMasterPin && styles.stepNumberDone]}>
                  <Text style={styles.stepNumberText}>1</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.stepTitle}>Parent Master PIN</Text>
                  <Text style={styles.stepDesc}>Required to uninstall, clear data, or modify settings</Text>
                </View>
                <View style={[styles.pill, status.hasMasterPin ? styles.pillOk : styles.pillWarn]}>
                  <Text style={[styles.pillText, status.hasMasterPin ? styles.pillTextOk : styles.pillTextWarn]}>
                    {status.hasMasterPin ? 'Configured' : 'Not Set'}
                  </Text>
                </View>
              </View>

              {!showPinSetup ? (
                <TouchableOpacity
                  style={styles.actionOutlineBtn}
                  onPress={() => setShowPinSetup(true)}
                  activeOpacity={0.8}
                >
                  <Icon name={status.hasMasterPin ? 'key-outline' : 'add-circle-outline'} size={16} color={Colors.brand.primary} />
                  <Text style={styles.actionOutlineBtnText}>
                    {status.hasMasterPin ? 'Change Master PIN' : 'Set Master PIN'}
                  </Text>
                </TouchableOpacity>
              ) : (
                <View style={styles.pinForm}>
                  {status.hasMasterPin && (
                    <TextInput
                      style={styles.input}
                      placeholder="Enter CURRENT Master PIN"
                      placeholderTextColor={Colors.text.tertiary}
                      keyboardType="numeric"
                      maxLength={6}
                      secureTextEntry
                      value={currentPin}
                      onChangeText={setCurrentPin}
                    />
                  )}
                  <TextInput
                    style={styles.input}
                    placeholder={status.hasMasterPin ? "Enter NEW 4-digit PIN" : "Enter 4-digit PIN"}
                    placeholderTextColor={Colors.text.tertiary}
                    keyboardType="numeric"
                    maxLength={6}
                    secureTextEntry
                    value={pinInput}
                    onChangeText={setPinInput}
                  />
                  <TextInput
                    style={styles.input}
                    placeholder={status.hasMasterPin ? "Confirm NEW PIN" : "Confirm PIN"}
                    placeholderTextColor={Colors.text.tertiary}
                    keyboardType="numeric"
                    maxLength={6}
                    secureTextEntry
                    value={pinConfirm}
                    onChangeText={setPinConfirm}
                  />
                  <View style={styles.pinBtnRow}>
                    <TouchableOpacity
                      style={styles.cancelBtn}
                      onPress={() => {
                        setShowPinSetup(false);
                        setCurrentPin('');
                        setPinInput('');
                        setPinConfirm('');
                      }}
                    >
                      <Text style={styles.cancelBtnText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.saveBtn}
                      onPress={handleSavePin}
                      disabled={loading}
                    >
                      {loading ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text style={styles.saveBtnText}>Save PIN</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>

            {/* Step 2: Device Admin */}
            <View style={styles.sectionCard}>
              <View style={styles.stepHeader}>
                <View style={[styles.stepNumber, status.isDeviceAdminActive && styles.stepNumberDone]}>
                  <Text style={styles.stepNumberText}>2</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.stepTitle}>Device Administrator</Text>
                  <Text style={styles.stepDesc}>Disables home screen drag-and-drop uninstallation</Text>
                </View>
                <View style={[styles.pill, status.isDeviceAdminActive ? styles.pillOk : styles.pillWarn]}>
                  <Text style={[styles.pillText, status.isDeviceAdminActive ? styles.pillTextOk : styles.pillTextWarn]}>
                    {status.isDeviceAdminActive ? 'Active' : 'Off'}
                  </Text>
                </View>
              </View>

              {!status.isDeviceAdminActive && (
                <TouchableOpacity
                  style={styles.actionBtn}
                  onPress={handleRequestAdmin}
                  activeOpacity={0.8}
                >
                  <Icon name="shield-outline" size={16} color="#fff" />
                  <Text style={styles.actionBtnText}>Activate Device Administrator</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Step 3: Accessibility Guard */}
            <View style={styles.sectionCard}>
              <View style={styles.stepHeader}>
                <View style={[styles.stepNumber, status.isAccessibilityEnabled && styles.stepNumberDone]}>
                  <Text style={styles.stepNumberText}>3</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.stepTitle}>Accessibility Guard</Text>
                  <Text style={styles.stepDesc}>Blocks Settings, App Info, Force Stop, and Clear Storage</Text>
                </View>
                <View style={[styles.pill, status.isAccessibilityEnabled ? styles.pillOk : styles.pillWarn]}>
                  <Text style={[styles.pillText, status.isAccessibilityEnabled ? styles.pillTextOk : styles.pillTextWarn]}>
                    {status.isAccessibilityEnabled ? 'Active' : 'Off'}
                  </Text>
                </View>
              </View>

              {!status.isAccessibilityEnabled && (
                <>
                  <TouchableOpacity
                    style={styles.actionBtn}
                    onPress={handleOpenAccessibility}
                    activeOpacity={0.8}
                  >
                    <Icon name="accessibility-outline" size={16} color="#fff" />
                    <Text style={styles.actionBtnText}>Enable Accessibility Service</Text>
                  </TouchableOpacity>
                  <View style={styles.xiaomiTip}>
                    <Icon name="information-circle-outline" size={15} color="#38BDF8" style={{ marginTop: 1 }} />
                    <Text style={styles.xiaomiTipText}>
                      On Xiaomi / HyperOS: Scroll down to <Text style={{ fontWeight: '700', color: '#fff' }}>"Downloaded apps"</Text> → tap <Text style={{ fontWeight: '700', color: '#fff' }}>CareTrack Child</Text> → turn <Text style={{ fontWeight: '700', color: '#10B981' }}>ON</Text>.
                    </Text>
                  </View>
                </>
              )}
            </View>

            {/* Step 4: Overlay Permission */}
            <View style={styles.sectionCard}>
              <View style={styles.stepHeader}>
                <View style={[styles.stepNumber, status.canDrawOverlays && styles.stepNumberDone]}>
                  <Text style={styles.stepNumberText}>4</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.stepTitle}>Display Over Other Apps</Text>
                  <Text style={styles.stepDesc}>Allows showing the Master PIN challenge over Settings</Text>
                </View>
                <View style={[styles.pill, status.canDrawOverlays ? styles.pillOk : styles.pillWarn]}>
                  <Text style={[styles.pillText, status.canDrawOverlays ? styles.pillTextOk : styles.pillTextWarn]}>
                    {status.canDrawOverlays ? 'Granted' : 'Off'}
                  </Text>
                </View>
              </View>

              {!status.canDrawOverlays && (
                <TouchableOpacity
                  style={styles.actionBtn}
                  onPress={handleRequestOverlay}
                  activeOpacity={0.8}
                >
                  <Icon name="layers-outline" size={16} color="#fff" />
                  <Text style={styles.actionBtnText}>Grant Overlay Permission</Text>
                </TouchableOpacity>
              )}
            </View>
          </ScrollView>

          {/* Done Button */}
          <View style={styles.footer}>
            <TouchableOpacity style={styles.doneBtn} onPress={handleClose} activeOpacity={0.85}>
              <LinearGradient
                colors={['#6C63FF', '#4F46E5']}
                style={styles.doneBtnGrad}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
              >
                <Text style={styles.doneBtnText}>Close</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: Colors.bg.secondary,
    borderTopLeftRadius: Radius.xxl,
    borderTopRightRadius: Radius.xxl,
    maxHeight: '90%',
    borderWidth: 1,
    borderColor: Colors.bg.glassBorder,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing.xl,
    paddingBottom: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.bg.glassBorder,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  shieldIconBox: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shieldOk: { backgroundColor: '#10B981' },
  shieldWarn: { backgroundColor: '#F59E0B' },
  title: {
    fontFamily: Fonts.bold,
    fontSize: Fonts.sizes.lg,
    color: Colors.text.primary,
  },
  subtitle: {
    fontFamily: Fonts.regular,
    fontSize: Fonts.sizes.xs,
    color: Colors.text.tertiary,
  },
  closeBtn: {
    padding: 6,
  },
  body: {
    padding: Spacing.xl,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: Spacing.md,
    borderRadius: Radius.lg,
    marginBottom: Spacing.lg,
  },
  bannerOk: {
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    borderColor: 'rgba(16, 185, 129, 0.3)',
    borderWidth: 1,
  },
  bannerWarn: {
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    borderColor: 'rgba(245, 158, 11, 0.3)',
    borderWidth: 1,
  },
  bannerText: {
    flex: 1,
    fontFamily: Fonts.medium,
    fontSize: Fonts.sizes.sm,
    color: Colors.text.primary,
    lineHeight: 18,
  },
  sectionCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  stepHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  stepNumber: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumberDone: {
    backgroundColor: Colors.brand.primary,
  },
  stepNumberText: {
    color: '#fff',
    fontFamily: Fonts.bold,
    fontSize: Fonts.sizes.xs,
  },
  stepTitle: {
    fontFamily: Fonts.semiBold,
    fontSize: Fonts.sizes.md,
    color: Colors.text.primary,
  },
  stepDesc: {
    fontFamily: Fonts.regular,
    fontSize: Fonts.sizes.xs,
    color: Colors.text.tertiary,
    marginTop: 2,
  },
  pill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  pillOk: {
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
  },
  pillWarn: {
    backgroundColor: 'rgba(245, 158, 11, 0.2)',
  },
  pillText: {
    fontFamily: Fonts.semiBold,
    fontSize: 10,
  },
  pillTextOk: {
    color: '#10B981',
  },
  pillTextWarn: {
    color: '#F59E0B',
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.brand.primary,
    borderRadius: Radius.md,
    paddingVertical: 10,
    marginTop: Spacing.md,
  },
  actionBtnText: {
    color: '#fff',
    fontFamily: Fonts.semiBold,
    fontSize: Fonts.sizes.sm,
  },
  xiaomiTip: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: 'rgba(56, 189, 248, 0.1)',
    borderRadius: Radius.md,
    padding: Spacing.sm + 2,
    marginTop: Spacing.sm,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.25)',
  },
  xiaomiTipText: {
    flex: 1,
    fontFamily: Fonts.regular,
    fontSize: 11.5,
    color: '#BAE6FD',
    lineHeight: 16,
  },
  actionOutlineBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.brand.primary,
    borderRadius: Radius.md,
    paddingVertical: 9,
    marginTop: Spacing.md,
  },
  actionOutlineBtnText: {
    color: Colors.brand.primary,
    fontFamily: Fonts.semiBold,
    fontSize: Fonts.sizes.sm,
  },
  pinForm: {
    marginTop: Spacing.md,
    gap: 10,
  },
  input: {
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: Radius.md,
    color: '#fff',
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    fontFamily: Fonts.medium,
    fontSize: Fonts.sizes.md,
  },
  pinBtnRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  cancelBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: Radius.md,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  cancelBtnText: {
    color: Colors.text.secondary,
    fontFamily: Fonts.medium,
    fontSize: Fonts.sizes.sm,
  },
  saveBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: Radius.md,
    backgroundColor: Colors.brand.primary,
  },
  saveBtnText: {
    color: '#fff',
    fontFamily: Fonts.semiBold,
    fontSize: Fonts.sizes.sm,
  },
  footer: {
    padding: Spacing.xl,
    paddingTop: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.bg.glassBorder,
  },
  doneBtn: {
    borderRadius: Radius.lg,
    overflow: 'hidden',
  },
  doneBtnGrad: {
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneBtnText: {
    color: '#fff',
    fontFamily: Fonts.bold,
    fontSize: Fonts.sizes.md,
  },
});
