import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  Modal, Alert, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/Ionicons';
import { Colors, Fonts, Spacing, Radius } from '../../theme/tokens';
import {
  getServerUrl, setServerConfig, parseServerUrl,
  DEFAULT_SERVER_URL,
} from '../../config/server';

export default function ServerSettingsModal({ visible, onClose, onSave }) {
  const [url, setUrl] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      let current = getServerUrl() || DEFAULT_SERVER_URL;
      // Clean up any previously corrupted string
      if (current.includes('ttp://') || (current.match(/http/gi) || []).length > 1) {
        current = DEFAULT_SERVER_URL;
      }
      setUrl(current);
    }
  }, [visible]);

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
      Alert.alert('Server Saved', `Active Server:\n${saved.fullBaseUrl}`);
      if (onSave) onSave();
      onClose();
    } catch (err) {
      Alert.alert('Error', 'Failed to save server settings: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handlePreset = (presetUrl) => {
    setUrl(presetUrl);
  };

  const handleReset = () => {
    setUrl(DEFAULT_SERVER_URL);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.modalBackdrop}
      >
        <View style={styles.modalContent}>
          <LinearGradient
            colors={['#161E2E', '#0F172A']}
            style={StyleSheet.absoluteFill}
          />

          {/* Header */}
          <View style={styles.modalHeader}>
            <View style={styles.headerTitleRow}>
              <View style={styles.iconCircle}>
                <Icon name="server-outline" size={20} color={Colors.brand.primary} />
              </View>
              <Text style={styles.title}>Backend Connection</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Icon name="close" size={22} color={Colors.text.secondary} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={styles.subtitle}>
              Configure server connection manually if pairing without QR scan (QR scan auto-configures this).
            </Text>

            {/* Quick Presets */}
            <Text style={styles.sectionLabel}>Quick Presets</Text>
            <View style={styles.presetRow}>
              <TouchableOpacity
                style={[
                  styles.presetBtn,
                  url === 'https://caretrack-backend-kv2n.onrender.com' && styles.presetBtnActive,
                ]}
                onPress={() => handlePreset('https://caretrack-backend-kv2n.onrender.com')}
              >
                <Text style={styles.presetText}>🌐 Cloud Server</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.presetBtn,
                  url === 'http://192.168.1.8:3010' && styles.presetBtnActive,
                ]}
                onPress={() => handlePreset('http://192.168.1.8:3010')}
              >
                <Text style={styles.presetText}>🏠 Local Wi-Fi</Text>
              </TouchableOpacity>
            </View>

            {/* Single Server URL Input */}
            <View style={styles.inputGroup}>
              <View style={styles.labelRow}>
                <Text style={styles.label}>Server URL</Text>
                <TouchableOpacity onPress={handleReset}>
                  <Text style={styles.resetText}>Reset to Default</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.inputWrapper}>
                <Icon name="globe-outline" size={18} color={Colors.text.tertiary} style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  value={url}
                  onChangeText={setUrl}
                  placeholder="https://caretrack-backend-kv2n.onrender.com"
                  placeholderTextColor={Colors.text.tertiary}
                  autoCapitalize="none"
                  autoCorrect={false}
                  selectTextOnFocus
                />
                {url ? (
                  <TouchableOpacity onPress={() => setUrl('')} style={styles.clearBtn}>
                    <Icon name="close-circle" size={18} color={Colors.text.tertiary} />
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>

            {/* Live Endpoints Preview */}
            <View style={styles.previewBox}>
              <Text style={styles.previewLabel}>Resolved Target:</Text>
              <Text style={styles.previewValue}>{preview.fullBaseUrl}</Text>
              <Text style={styles.previewSub}>
                API: {preview.fullBaseUrl}/api
              </Text>
              <Text style={styles.previewSub}>
                Socket: {preview.socketUrl} ({preview.socketPath})
              </Text>
            </View>

            {/* Action Buttons */}
            <View style={styles.btnRow}>
              <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.saveBtn, saving && { opacity: 0.6 }]}
                onPress={handleSave}
                disabled={saving}
              >
                <LinearGradient
                  colors={[Colors.brand.primary, '#8B5CF6']}
                  style={styles.saveBtnGrad}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                >
                  {saving ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={styles.saveBtnText}>Save Connection</Text>
                  )}
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xl,
  },
  modalContent: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '90%',
    borderRadius: Radius.xxl,
    overflow: 'hidden',
    padding: Spacing.xxl,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.sm,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(108, 99, 255, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontFamily: Fonts.bold,
    fontSize: Fonts.sizes.xl,
    color: Colors.text.primary,
  },
  closeBtn: {
    padding: 4,
  },
  subtitle: {
    fontFamily: Fonts.regular,
    fontSize: Fonts.sizes.sm,
    color: Colors.text.secondary,
    lineHeight: 20,
    marginBottom: Spacing.md,
  },
  sectionLabel: {
    fontFamily: Fonts.medium,
    fontSize: Fonts.sizes.xs,
    color: Colors.text.tertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  presetRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: Spacing.md,
  },
  presetBtn: {
    flex: 1,
    paddingVertical: 9,
    paddingHorizontal: 8,
    borderRadius: Radius.md,
    backgroundColor: Colors.bg.tertiary,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
  },
  presetBtnActive: {
    borderColor: Colors.brand.primary,
    backgroundColor: 'rgba(108, 99, 255, 0.15)',
  },
  presetText: {
    fontFamily: Fonts.medium,
    fontSize: Fonts.sizes.xs,
    color: Colors.text.primary,
  },
  inputGroup: {
    marginBottom: Spacing.md,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  label: {
    fontFamily: Fonts.medium,
    fontSize: Fonts.sizes.sm,
    color: Colors.text.secondary,
  },
  resetText: {
    fontFamily: Fonts.medium,
    fontSize: Fonts.sizes.xs,
    color: Colors.brand.primary,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.bg.primary,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.bg.glassBorder,
    paddingHorizontal: 12,
  },
  inputIcon: {
    marginRight: 8,
  },
  input: {
    flex: 1,
    height: 48,
    color: Colors.text.primary,
    fontFamily: Fonts.regular,
    fontSize: Fonts.sizes.sm,
  },
  clearBtn: {
    padding: 4,
  },
  previewBox: {
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderRadius: Radius.md,
    padding: 12,
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  previewLabel: {
    fontFamily: Fonts.semiBold,
    fontSize: Fonts.sizes.xs,
    color: Colors.text.tertiary,
    marginBottom: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  previewValue: {
    fontFamily: Fonts.mono || Fonts.regular,
    fontSize: Fonts.sizes.sm,
    color: Colors.status.online,
    marginBottom: 4,
  },
  previewSub: {
    fontFamily: Fonts.regular,
    fontSize: Fonts.sizes.xs,
    color: Colors.text.tertiary,
    marginTop: 2,
  },
  btnRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: Spacing.xs,
    marginBottom: Spacing.sm,
  },
  cancelBtn: {
    flex: 1,
    height: 46,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.bg.tertiary,
  },
  cancelBtnText: {
    fontFamily: Fonts.semiBold,
    fontSize: Fonts.sizes.md,
    color: Colors.text.secondary,
  },
  saveBtn: {
    flex: 2,
    height: 46,
    borderRadius: Radius.lg,
    overflow: 'hidden',
  },
  saveBtnGrad: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnText: {
    fontFamily: Fonts.semiBold,
    fontSize: Fonts.sizes.md,
    color: '#FFFFFF',
  },
});
