import React, { useState } from 'react';
import {
  View, Text, StyleSheet, Modal, TouchableOpacity, TextInput,
  Alert, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons as Icon } from '@expo/vector-icons';
import { Colors, Fonts, Spacing, Radius } from '../theme/tokens';
import { childAPI } from '../services/api';

export default function ChildPinResetModal({ visible, child, onClose }) {
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    if (pin.length < 4 || pin.length > 6) {
      Alert.alert('Invalid PIN', 'Master PIN must be 4 to 6 numeric digits.');
      return;
    }
    if (!/^\d+$/.test(pin)) {
      Alert.alert('Invalid PIN', 'PIN must contain digits only.');
      return;
    }
    if (pin !== confirmPin) {
      Alert.alert('PIN Mismatch', 'The entered PINs do not match.');
      return;
    }

    setLoading(true);
    try {
      await childAPI.updateTamperPin(child.id, pin);
      Alert.alert(
        'PIN Updated',
        `Master PIN for ${child.name || 'child'} has been remotely updated.`,
      );
      setPin('');
      setConfirmPin('');
      onClose();
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Failed to update PIN.';
      Alert.alert('Update Failed', msg);
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
              <Icon name="shield-checkmark" size={26} color="#6C63FF" />
            </View>
            <Text style={styles.title}>Manage Tamper PIN</Text>
            <Text style={styles.subtitle}>
              Set or reset the protection PIN for <Text style={{ fontWeight: '700', color: '#fff' }}>{child?.name || 'Child'}</Text>'s phone.
            </Text>
          </View>

          <View style={styles.form}>
            <Text style={styles.label}>New Master PIN (4 digits)</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. 1234"
              placeholderTextColor={Colors.text.tertiary}
              keyboardType="numeric"
              maxLength={6}
              secureTextEntry
              value={pin}
              onChangeText={setPin}
            />

            <Text style={[styles.label, { marginTop: 12 }]}>Confirm Master PIN</Text>
            <TextInput
              style={styles.input}
              placeholder="Re-enter PIN"
              placeholderTextColor={Colors.text.tertiary}
              keyboardType="numeric"
              maxLength={6}
              secureTextEntry
              value={confirmPin}
              onChangeText={setConfirmPin}
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
                style={styles.saveBtn}
                onPress={handleSave}
                disabled={loading}
              >
                <LinearGradient
                  colors={['#6C63FF', '#4F46E5']}
                  style={styles.saveBtnGrad}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                >
                  {loading ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.saveBtnText}>Update PIN</Text>
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
    maxWidth: 360,
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
    fontSize: 16,
    letterSpacing: 4,
    textAlign: 'center',
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
  saveBtn: {
    flex: 1.5,
    height: 44,
    borderRadius: Radius.md,
    overflow: 'hidden',
  },
  saveBtnGrad: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  saveBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
});
