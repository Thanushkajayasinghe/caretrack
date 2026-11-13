import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ScrollView, Alert, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons as Icon } from '@expo/vector-icons';
import { Colors, Fonts, Spacing, Radius, Shadows } from '../../theme/tokens';
import {
  getServerUrl, setServerConfig, parseServerUrl,
  DEFAULT_SERVER_URL,
} from '../../config/server';
import { disconnectSocket, connectSocket } from '../../services/socket';
import { authAPI } from '../../services/api';
import CompleteProfileModal from '../../components/CompleteProfileModal';
export default function SettingsScreen({ onLogout }) {
  const [parentName, setParentName] = useState('');
  const [parentEmail, setParentEmail] = useState('');
  const [parentPhone, setParentPhone] = useState('');
  const [showEditProfileModal, setShowEditProfileModal] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [url, setUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null); // { success: boolean, msg: string, ms?: number }

  useEffect(() => {
    AsyncStorage.getItem('parentName').then((n) => setParentName(n || 'Parent'));
    AsyncStorage.getItem('parentEmail').then((e) => setParentEmail(e || 'parent@caretrack.app'));
    AsyncStorage.getItem('parentPhone').then((p) => setParentPhone(p || ''));

    // Fetch fresh profile from server
    authAPI.me().then(({ data }) => {
      if (data?.parent) {
        if (data.parent.name) {
          setParentName(data.parent.name);
          AsyncStorage.setItem('parentName', data.parent.name);
        }
        if (data.parent.email) {
          setParentEmail(data.parent.email);
          AsyncStorage.setItem('parentEmail', data.parent.email);
        }
        if (data.parent.phone) {
          setParentPhone(data.parent.phone);
          AsyncStorage.setItem('parentPhone', data.parent.phone);
        }
      }
    }).catch(() => {});

    let current = getServerUrl() || DEFAULT_SERVER_URL;
    if (current.includes('ttp://') || (current.match(/http/gi) || []).length > 1) {
      current = DEFAULT_SERVER_URL;
    }
    setUrl(current);
  }, []);

  const preview = parseServerUrl(url);

  const handleSave = async () => {
    const trimmed = (url || '').trim();
    if (!trimmed) {
      Alert.alert('Invalid URL', 'Please enter a valid server URL.');
      return;
    }

    setSaving(true);
    try {
      const saved = await setServerConfig(trimmed);
      disconnectSocket();
      connectSocket();
      setTestResult(null);
      Alert.alert('Server Saved', `Active Server:\n${saved.fullBaseUrl}\n\nSocket and API reconnected.`);
    } catch (err) {
      Alert.alert('Error', 'Failed to save server settings: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    const trimmed = (url || '').trim();
    if (!trimmed) return;
    setTesting(true);
    setTestResult(null);

    const parsed = parseServerUrl(trimmed);
    const healthUrl = `${parsed.fullBaseUrl}/health`;
    const t0 = Date.now();

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000);

      const res = await fetch(healthUrl, {
        method: 'GET',
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const ms = Date.now() - t0;
      if (res.ok) {
        setTestResult({ success: true, msg: `Online (${ms}ms)`, ms });
      } else {
        setTestResult({ success: false, msg: `Server HTTP ${res.status}` });
      }
    } catch (err) {
      const isTimeout = err.name === 'AbortError';
      setTestResult({
        success: false,
        msg: isTimeout ? 'Connection timed out (>12s)' : 'Unable to connect',
      });
    } finally {
      setTesting(false);
    }
  };

  const handlePreset = (presetUrl) => {
    setUrl(presetUrl);
    setTestResult(null);
  };

  const handleReset = () => {
    setUrl(DEFAULT_SERVER_URL);
    setTestResult(null);
  };

  const handleLogoutPress = () => {
    Alert.alert(
      'Log Out',
      'Are you sure you want to log out of CareTrack Parent?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Log Out',
          style: 'destructive',
          onPress: async () => {
            disconnectSocket();
            await AsyncStorage.multiRemove([
              'accessToken',
              'refreshToken',
              'parentId',
              'parentName',
              'parentEmail',
            ]);
            if (onLogout) onLogout();
          },
        },
      ],
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <LinearGradient colors={['#0A0E1A', '#111827']} style={StyleSheet.absoluteFill} />

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerTitleRow}>
          <View style={styles.headerIconCircle}>
            <Icon name="settings-sharp" size={22} color={Colors.brand.primary} />
          </View>
          <View>
            <Text style={styles.headerTitle}>Settings</Text>
            <Text style={styles.headerSubtitle}>Account & server configuration</Text>
          </View>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Account Profile Card */}
        <View style={styles.card}>
          <View style={styles.accountRow}>
            <View style={styles.accountAvatar}>
              <Text style={styles.accountAvatarText}>
                {parentName ? parentName[0].toUpperCase() : 'P'}
              </Text>
            </View>
            <View style={styles.accountDetails}>
              <Text style={styles.accountName}>{parentName}</Text>
              <Text style={styles.accountEmail}>{parentEmail}</Text>
              {parentPhone ? (
                <Text style={styles.accountPhone}>📞 {parentPhone}</Text>
              ) : (
                <TouchableOpacity
                  onPress={() => setShowEditProfileModal(true)}
                  style={styles.phoneWarningPill}
                  activeOpacity={0.7}
                >
                  <Icon name="alert-circle-outline" size={13} color="#F59E0B" />
                  <Text style={styles.phoneWarningText}>Add phone number</Text>
                </TouchableOpacity>
              )}
              <View style={styles.statusBadge}>
                <View style={styles.statusDot} />
                <Text style={styles.statusBadgeText}>Account Active</Text>
              </View>
            </View>
            <TouchableOpacity
              style={styles.editProfileBtn}
              onPress={() => setShowEditProfileModal(true)}
              activeOpacity={0.7}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Icon name="create-outline" size={18} color={Colors.brand.primary} />
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={styles.logoutBtn}
            onPress={handleLogoutPress}
            activeOpacity={0.8}
          >
            <Icon name="log-out-outline" size={18} color={Colors.status.danger} />
            <Text style={styles.logoutBtnText}>Log Out of Account</Text>
          </TouchableOpacity>
        </View>

        {/* Backend Connection Card */}
        <View style={styles.card}>
          <View style={styles.sectionHeader}>
            <Icon name="server" size={18} color={Colors.brand.primary} />
            <Text style={styles.sectionTitle}>Backend Server Connection</Text>
          </View>
          <Text style={styles.sectionDesc}>
            Configure the host URL for live GPS sync, pairing, and history telemetry.
          </Text>

          {/* URL Input */}
          <Text style={styles.inputLabel}>Server Base URL</Text>
          <View style={styles.inputContainer}>
            <Icon name="globe-outline" size={18} color={Colors.text.tertiary} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              value={url}
              onChangeText={(txt) => {
                setUrl(txt);
                setTestResult(null);
              }}
              placeholder="http://123.231.114.160:5000/caretrack"
              placeholderTextColor={Colors.text.tertiary}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
            {url ? (
              <TouchableOpacity onPress={() => setUrl('')} style={styles.clearBtn}>
                <Icon name="close-circle" size={16} color={Colors.text.tertiary} />
              </TouchableOpacity>
            ) : null}
          </View>

          {/* Connection Test Result */}
          {testResult && (
            <View
              style={[
                styles.testBadge,
                testResult.success ? styles.testBadgeSuccess : styles.testBadgeError,
              ]}
            >
              <Icon
                name={testResult.success ? 'checkmark-circle' : 'alert-circle'}
                size={16}
                color={testResult.success ? '#10B981' : '#EF4444'}
              />
              <Text
                style={[
                  styles.testBadgeText,
                  testResult.success ? styles.testSuccessText : styles.testErrorText,
                ]}
              >
                {testResult.msg}
              </Text>
            </View>
          )}

          {/* Action Buttons: Test Connection + Save */}
          <View style={styles.btnRow}>
            <TouchableOpacity
              style={styles.testBtn}
              onPress={handleTestConnection}
              disabled={testing || !url.trim()}
              activeOpacity={0.8}
            >
              {testing ? (
                <ActivityIndicator size="small" color={Colors.brand.primary} />
              ) : (
                <>
                  <Icon name="pulse-outline" size={16} color={Colors.brand.primary} />
                  <Text style={styles.testBtnText}>Test Server</Text>
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.saveBtn}
              onPress={handleSave}
              disabled={saving}
              activeOpacity={0.8}
            >
              <LinearGradient
                colors={[Colors.brand.primary, '#8B5CF6']}
                style={styles.saveBtnGrad}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
              >
                {saving ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Icon name="save-outline" size={16} color="#fff" />
                    <Text style={styles.saveBtnText}>Save Connection</Text>
                  </>
                )}
              </LinearGradient>
            </TouchableOpacity>
          </View>

          {/* Quick Presets */}
          <Text style={styles.presetLabel}>Quick Presets</Text>
          <View style={styles.presetGrid}>
            <TouchableOpacity
              style={[
                styles.presetChip,
                url === 'https://caretrack-backend-kv2n.onrender.com' && styles.presetChipActive,
              ]}
              onPress={() => handlePreset('https://caretrack-backend-kv2n.onrender.com')}
              activeOpacity={0.8}
            >
              <Icon name="cloud-done" size={14} color={url === 'https://caretrack-backend-kv2n.onrender.com' ? Colors.brand.primary : Colors.text.tertiary} />
              <Text
                style={[
                  styles.presetChipText,
                  url === 'https://caretrack-backend-kv2n.onrender.com' && styles.presetChipTextActive,
                ]}
              >
                Cloud Server (Render)
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.presetChip,
                url === 'http://123.231.114.160:5000/caretrack' && styles.presetChipActive,
              ]}
              onPress={() => handlePreset('http://123.231.114.160:5000/caretrack')}
              activeOpacity={0.8}
            >
              <Icon name="server" size={14} color={url === 'http://123.231.114.160:5000/caretrack' ? Colors.brand.primary : Colors.text.tertiary} />
              <Text
                style={[
                  styles.presetChipText,
                  url === 'http://123.231.114.160:5000/caretrack' && styles.presetChipTextActive,
                ]}
              >
                Local Server
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.presetChip,
                url === 'http://192.168.1.8:3000' && styles.presetChipActive,
              ]}
              onPress={() => handlePreset('http://192.168.1.8:3000')}
              activeOpacity={0.8}
            >
              <Icon name="wifi" size={14} color={url === 'http://192.168.1.8:3000' ? Colors.brand.primary : Colors.text.tertiary} />
              <Text
                style={[
                  styles.presetChipText,
                  url === 'http://192.168.1.8:3000' && styles.presetChipTextActive,
                ]}
              >
                Local Wi-Fi
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.presetChip,
                url === 'http://10.0.2.2:3000' && styles.presetChipActive,
              ]}
              onPress={() => handlePreset('http://10.0.2.2:3000')}
              activeOpacity={0.8}
            >
              <Icon name="laptop-outline" size={14} color={url === 'http://10.0.2.2:3000' ? Colors.brand.primary : Colors.text.tertiary} />
              <Text
                style={[
                  styles.presetChipText,
                  url === 'http://10.0.2.2:3000' && styles.presetChipTextActive,
                ]}
              >
                Emulator
              </Text>
            </TouchableOpacity>
          </View>

          {/* Reset to Default */}
          <TouchableOpacity style={styles.resetBtn} onPress={handleReset} activeOpacity={0.7}>
            <Icon name="refresh-outline" size={14} color={Colors.text.tertiary} />
            <Text style={styles.resetBtnText}>Reset to Default (Render Cloud)</Text>
          </TouchableOpacity>

          {/* Live Preview Box */}
          <View style={styles.previewBox}>
            <Text style={styles.previewTitle}>Active Endpoints Breakdown</Text>
            <View style={styles.previewRow}>
              <Text style={styles.previewLabel}>API Base:</Text>
              <Text style={styles.previewValue} numberOfLines={1}>
                {preview.fullBaseUrl}/api
              </Text>
            </View>
            <View style={styles.previewRow}>
              <Text style={styles.previewLabel}>Socket:</Text>
              <Text style={styles.previewValue} numberOfLines={1}>
                {preview.socketUrl} ({preview.socketPath})
              </Text>
            </View>
          </View>
        </View>



        {/* Version Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>CareTrack Parent • Version 1.0.0 (Build 2026.09)</Text>
          <Text style={styles.footerSubText}>Real-time family safety & intelligent location tracking</Text>
        </View>
      </ScrollView>

      <CompleteProfileModal
        visible={showEditProfileModal}
        initialName={parentName}
        initialPhone={parentPhone}
        loading={profileSaving}
        onSave={async ({ name: updatedName, phone: updatedPhone }) => {
          setProfileSaving(true);
          try {
            const { data } = await authAPI.updateProfile({ name: updatedName, phone: updatedPhone });
            if (data?.parent) {
              setParentName(data.parent.name || updatedName);
              setParentPhone(data.parent.phone || updatedPhone);
              await AsyncStorage.multiSet([
                ['parentName', data.parent.name || updatedName],
                ['parentPhone', data.parent.phone || updatedPhone],
              ]);
            }
            setShowEditProfileModal(false);
            Alert.alert('Profile Updated', 'Your profile details have been saved.');
          } catch (err) {
            const msg = err.response?.data?.error || err.message || 'Failed to update profile.';
            Alert.alert('Error', msg);
          } finally {
            setProfileSaving(false);
          }
        }}
        onSkip={() => setShowEditProfileModal(false)}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg.primary,
  },
  header: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Platform.OS === 'ios' ? 60 : 44,
    paddingBottom: Spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: Colors.bg.glassBorder,
    backgroundColor: Colors.bg.secondary,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  headerIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: `${Colors.brand.primary}20`,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: `${Colors.brand.primary}40`,
  },
  headerTitle: {
    fontFamily: Fonts.bold,
    fontSize: Fonts.sizes.xl,
    color: Colors.text.primary,
  },
  headerSubtitle: {
    fontFamily: Fonts.regular,
    fontSize: Fonts.sizes.sm,
    color: Colors.text.tertiary,
    marginTop: 2,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: Spacing.lg,
    gap: Spacing.lg,
    paddingBottom: 40,
  },
  card: {
    backgroundColor: Colors.bg.secondary,
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.bg.glassBorder,
    ...Shadows.md,
  },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginBottom: Spacing.md,
  },
  accountAvatar: {
    width: 54,
    height: 54,
    borderRadius: 18,
    backgroundColor: `${Colors.brand.primary}25`,
    borderWidth: 1.5,
    borderColor: `${Colors.brand.primary}60`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accountAvatarText: {
    fontFamily: Fonts.bold,
    fontSize: Fonts.sizes.xl,
    color: Colors.brand.primary,
  },
  accountDetails: {
    flex: 1,
  },
  accountName: {
    fontFamily: Fonts.bold,
    fontSize: Fonts.sizes.lg,
    color: Colors.text.primary,
  },
  accountEmail: {
    fontFamily: Fonts.regular,
    fontSize: Fonts.sizes.sm,
    color: Colors.text.secondary,
    marginTop: 2,
  },
  accountPhone: {
    fontFamily: Fonts.medium,
    fontSize: Fonts.sizes.xs,
    color: '#93C5FD',
    marginTop: 3,
  },
  phoneWarningPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.3)',
    borderRadius: Radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  phoneWarningText: {
    fontFamily: Fonts.medium,
    fontSize: 11,
    color: '#F59E0B',
  },
  editProfileBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: `${Colors.brand.primary}18`,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: `${Colors.brand.primary}35`,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: Colors.status.online,
  },
  statusBadgeText: {
    fontFamily: Fonts.medium,
    fontSize: Fonts.sizes.xs,
    color: Colors.status.online,
  },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 42,
    borderRadius: Radius.md,
    gap: 8,
    backgroundColor: `${Colors.status.danger}15`,
    borderWidth: 1,
    borderColor: `${Colors.status.danger}40`,
    marginTop: Spacing.xs,
  },
  logoutBtnText: {
    fontFamily: Fonts.semiBold,
    fontSize: Fonts.sizes.sm,
    color: Colors.status.danger,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  sectionTitle: {
    fontFamily: Fonts.bold,
    fontSize: Fonts.sizes.md,
    color: Colors.text.primary,
  },
  sectionDesc: {
    fontFamily: Fonts.regular,
    fontSize: Fonts.sizes.sm,
    color: Colors.text.secondary,
    marginBottom: Spacing.md,
    lineHeight: 18,
  },
  inputLabel: {
    fontFamily: Fonts.medium,
    fontSize: Fonts.sizes.xs,
    color: Colors.text.secondary,
    marginBottom: 6,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.bg.tertiary,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.bg.glassBorder,
    paddingHorizontal: Spacing.md,
    height: 46,
    marginBottom: Spacing.sm,
  },
  inputIcon: {
    marginRight: 8,
  },
  input: {
    flex: 1,
    fontFamily: Fonts.regular,
    fontSize: Fonts.sizes.sm,
    color: Colors.text.primary,
    paddingVertical: 0,
  },
  clearBtn: {
    padding: 4,
  },
  testBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: Radius.sm,
    marginBottom: Spacing.sm,
  },
  testBadgeSuccess: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  testBadgeError: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  testBadgeText: {
    fontFamily: Fonts.medium,
    fontSize: Fonts.sizes.xs,
  },
  testSuccessText: {
    color: '#10B981',
  },
  testErrorText: {
    color: '#EF4444',
  },
  btnRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: 4,
    marginBottom: Spacing.md,
  },
  testBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 42,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: `${Colors.brand.primary}50`,
    backgroundColor: `${Colors.brand.primary}12`,
    gap: 6,
  },
  testBtnText: {
    fontFamily: Fonts.semiBold,
    fontSize: Fonts.sizes.sm,
    color: Colors.brand.primary,
  },
  saveBtn: {
    flex: 1.3,
  },
  saveBtnGrad: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 42,
    borderRadius: Radius.md,
    gap: 6,
  },
  saveBtnText: {
    fontFamily: Fonts.semiBold,
    fontSize: Fonts.sizes.sm,
    color: '#fff',
  },
  presetLabel: {
    fontFamily: Fonts.medium,
    fontSize: Fonts.sizes.xs,
    color: Colors.text.tertiary,
    marginBottom: 8,
  },
  presetGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: Spacing.sm,
  },
  presetChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: Radius.full,
    backgroundColor: Colors.bg.tertiary,
    borderWidth: 1,
    borderColor: Colors.bg.glassBorder,
  },
  presetChipActive: {
    borderColor: Colors.brand.primary,
    backgroundColor: `${Colors.brand.primary}20`,
  },
  presetChipText: {
    fontFamily: Fonts.medium,
    fontSize: Fonts.sizes.xs,
    color: Colors.text.secondary,
  },
  presetChipTextActive: {
    color: Colors.brand.primary,
    fontFamily: Fonts.semiBold,
  },
  resetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingVertical: 6,
    marginBottom: Spacing.md,
  },
  resetBtnText: {
    fontFamily: Fonts.regular,
    fontSize: Fonts.sizes.xs,
    color: Colors.text.tertiary,
  },
  previewBox: {
    backgroundColor: Colors.bg.tertiary,
    borderRadius: Radius.md,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.bg.glassBorder,
    gap: 6,
  },
  previewTitle: {
    fontFamily: Fonts.semiBold,
    fontSize: Fonts.sizes.xs,
    color: Colors.text.secondary,
    marginBottom: 2,
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  previewLabel: {
    fontFamily: Fonts.medium,
    fontSize: Fonts.sizes.xs,
    color: Colors.text.tertiary,
    width: 65,
  },
  previewValue: {
    fontFamily: Fonts.regular,
    fontSize: Fonts.sizes.xs,
    color: Colors.text.primary,
    flex: 1,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.sm,
  },
  infoLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    flex: 1,
  },
  infoTitle: {
    fontFamily: Fonts.semiBold,
    fontSize: Fonts.sizes.sm,
    color: Colors.text.primary,
  },
  infoDesc: {
    fontFamily: Fonts.regular,
    fontSize: Fonts.sizes.xs,
    color: Colors.text.tertiary,
    marginTop: 1,
  },
  infoDivider: {
    height: 1,
    backgroundColor: Colors.bg.glassBorder,
    marginVertical: 4,
  },
  enabledBadge: {
    backgroundColor: `${Colors.brand.primary}15`,
    borderRadius: Radius.full,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: `${Colors.brand.primary}30`,
  },
  enabledBadgeText: {
    fontFamily: Fonts.semiBold,
    fontSize: Fonts.sizes.xs,
    color: Colors.brand.primary,
  },
  footer: {
    alignItems: 'center',
    gap: 4,
    paddingVertical: Spacing.md,
  },
  footerText: {
    fontFamily: Fonts.medium,
    fontSize: Fonts.sizes.xs,
    color: Colors.text.tertiary,
  },
  footerSubText: {
    fontFamily: Fonts.regular,
    fontSize: 10,
    color: Colors.text.tertiary,
  },
  // Movement Sensitivity Card Styles
  childSelectorRow: {
    marginBottom: Spacing.md,
  },
  childSelectorLabel: {
    fontFamily: Fonts.medium,
    fontSize: Fonts.sizes.xs,
    color: Colors.text.secondary,
    marginBottom: 6,
  },
  childSelectorList: {
    flexDirection: 'row',
    gap: 8,
  },
  childChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: Radius.full,
    backgroundColor: Colors.bg.tertiary,
    borderWidth: 1,
    borderColor: Colors.bg.glassBorder,
  },
  childChipActive: {
    backgroundColor: `${Colors.brand.primary}25`,
    borderColor: Colors.brand.primary,
  },
  childAvatarDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  childChipText: {
    fontFamily: Fonts.medium,
    fontSize: Fonts.sizes.xs,
    color: Colors.text.secondary,
  },
  childChipTextActive: {
    color: Colors.text.primary,
    fontFamily: Fonts.semiBold,
  },
  currentThresholdBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.bg.tertiary,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.bg.glassBorder,
    marginBottom: Spacing.md,
  },
  thresholdBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  thresholdIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: `${Colors.brand.primary}18`,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: `${Colors.brand.primary}35`,
  },
  thresholdBannerLabel: {
    fontFamily: Fonts.regular,
    fontSize: Fonts.sizes.xs,
    color: Colors.text.tertiary,
  },
  thresholdBannerValue: {
    fontFamily: Fonts.bold,
    fontSize: Fonts.sizes.md,
    color: Colors.text.primary,
  },
  activeSensorBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.25)',
  },
  activeSensorText: {
    fontFamily: Fonts.medium,
    fontSize: Fonts.sizes.xs,
    color: '#10B981',
  },
  subFieldLabel: {
    fontFamily: Fonts.medium,
    fontSize: Fonts.sizes.xs,
    color: Colors.text.secondary,
    marginBottom: 8,
  },
  presetGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  distPresetBtn: {
    flex: 1,
    minWidth: '18%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderRadius: Radius.md,
    backgroundColor: Colors.bg.tertiary,
    borderWidth: 1,
    borderColor: Colors.bg.glassBorder,
  },
  distPresetBtnActive: {
    backgroundColor: `${Colors.brand.primary}30`,
    borderColor: Colors.brand.primary,
  },
  distPresetTitle: {
    fontFamily: Fonts.bold,
    fontSize: Fonts.sizes.sm,
    color: Colors.text.secondary,
  },
  distPresetTitleActive: {
    color: Colors.brand.primary,
  },
  distPresetSubtitle: {
    fontFamily: Fonts.regular,
    fontSize: 9,
    color: Colors.text.tertiary,
    marginTop: 2,
  },
  distPresetSubtitleActive: {
    color: Colors.text.secondary,
  },
  customDistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  customInputContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.bg.tertiary,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.bg.glassBorder,
    paddingHorizontal: Spacing.md,
    height: 44,
  },
  customInput: {
    flex: 1,
    fontFamily: Fonts.semiBold,
    fontSize: Fonts.sizes.md,
    color: Colors.text.primary,
    padding: 0,
  },
  customInputUnit: {
    fontFamily: Fonts.medium,
    fontSize: Fonts.sizes.sm,
    color: Colors.text.tertiary,
  },
  saveCustomBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 44,
    paddingHorizontal: 18,
    borderRadius: Radius.md,
    backgroundColor: Colors.brand.primary,
  },
  saveCustomBtnText: {
    fontFamily: Fonts.semiBold,
    fontSize: Fonts.sizes.sm,
    color: '#FFFFFF',
  },
  feedbackBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    borderRadius: Radius.md,
    padding: Spacing.sm,
    paddingHorizontal: Spacing.md,
    marginTop: Spacing.md,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.25)',
  },
  feedbackText: {
    fontFamily: Fonts.medium,
    fontSize: Fonts.sizes.xs,
    color: '#10B981',
    flex: 1,
  },
});
