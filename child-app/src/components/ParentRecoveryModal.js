import React, { useState } from 'react';
import {
  View, Text, StyleSheet, Modal, TouchableOpacity, TextInput,
  Alert, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/Ionicons';
import axios from 'axios';
import { Colors, Fonts, Spacing, Radius } from '../theme/tokens';
import { getBaseUrl } from '../config/server';
import { unlockMaintenanceMode } from '../services/locationService';

export default function ParentRecoveryModal({ visible, onClose, onSuccess }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleVerify = async () => {
    const trimmedPass = password.trim();
    if (!trimmedPass) {
      Alert.alert('Required', 'Please enter your CareTrack Parent account password.');
      return;
    }

    setLoading(true);
    try {
      const deviceToken = await AsyncStorage.getItem('deviceToken');
      const targetUrl = `${getBaseUrl()}/pair/verify-parent-password`;

      const payload = {
        deviceToken: deviceToken || undefined,
        parentEmail: email.trim() ? email.trim() : undefined,
        password: trimmedPass,
      };

      const res = await axios.post(targetUrl, payload, { timeout: 12000 });

      if (res.data?.success) {
        // Unlock maintenance window for 5 minutes
        await unlockMaintenanceMode('999999').catch(() => {});
        Alert.alert(
          'Verification Successful',
          'Parent account verified. Master PIN protection has been temporarily unlocked.',
        );
        setPassword('');
        setEmail('');
        onSuccess();
      } else {
        Alert.alert('Authentication Failed', res.data?.error || 'Invalid parent password.');
      }
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Unable to verify parent password.';
      Alert.alert('Authentication Failed', msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.card}>
          <View style={styles.header}>
            <View style={styles.iconCircle}>
              <Icon name="key" size={24} color="#6C63FF" />
            </View>
            <Text style={styles.title}>Parent Account Recovery</Text>
            <Text style={styles.subtitle}>
              Forgot the 4-digit Master PIN? Authenticate using your CareTrack Parent Account to unlock settings.
            </Text>
          </View>

          <View style={styles.form}>
            <Text style={styles.label}>Parent Account Email (Optional if paired)</Text>
            <TextInput
              style={styles.input}
              placeholder="parent@example.com"
              placeholderTextColor={Colors.text.tertiary}
              keyboardType="email-address"
              autoCapitalize="none"
              value={email}
              onChangeText={setEmail}
            />

            <Text style={[styles.label, { marginTop: 12 }]}>Parent Account Password</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter your CareTrack password"
              placeholderTextColor={Colors.text.tertiary}
              secureTextEntry
              value={password}
              onChangeText={setPassword}
            />

            <View style={styles.btnRow}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={onClose}
                disabled={loading}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.verifyBtn}
                onPress={handleVerify}
                disabled={loading}
              >
                <LinearGradient
                  colors={['#6C63FF', '#4F46E5']}
                  style={styles.verifyBtnGrad}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                >
                  {loading ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.verifyBtnText}>Verify & Unlock</Text>
                  )}
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.lg,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#111827',
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    padding: Spacing.xl,
  },
  header: {
    alignItems: 'center',
    marginBottom: Spacing.lg,
  },
  iconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(108, 99, 255, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 6,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 13,
    color: '#94A3B8',
    textAlign: 'center',
    lineHeight: 18,
  },
  form: {
    width: '100%',
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: '#CBD5E1',
    marginBottom: 6,
  },
  input: {
    height: 46,
    backgroundColor: '#1E293B',
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 14,
    color: '#fff',
    fontSize: 14,
  },
  btnRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 20,
  },
  cancelBtn: {
    flex: 1,
    height: 44,
    borderRadius: Radius.md,
    backgroundColor: '#1E293B',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  cancelBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#94A3B8',
  },
  verifyBtn: {
    flex: 1.5,
    height: 44,
    borderRadius: Radius.md,
    overflow: 'hidden',
  },
  verifyBtnGrad: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  verifyBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
});
