import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, Modal, TouchableOpacity,
  Vibration, Platform,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/Ionicons';
import { Colors, Fonts, Spacing, Radius } from '../theme/tokens';
import { verifyMasterPin, unlockMaintenanceMode } from '../services/locationService';
import ParentRecoveryModal from './ParentRecoveryModal';

export default function PinChallengeModal({
  visible,
  onClose,
  onSuccess,
  title = 'Enter Master PIN',
  subtitle = 'Enter the 4-digit Parent Master PIN to access protected settings',
}) {
  const [pin, setPin] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [attemptsLeft, setAttemptsLeft] = useState(5);
  const [recoveryOpen, setRecoveryOpen] = useState(false);

  useEffect(() => {
    if (visible) {
      setPin('');
      setErrorMsg('');
      setAttemptsLeft(5);
    }
  }, [visible]);

  const handleKeyPress = async (key) => {
    if (key === 'back') {
      if (pin.length > 0) {
        setPin(pin.slice(0, -1));
        setErrorMsg('');
      }
      return;
    }

    if (pin.length >= 4) return;

    const nextPin = pin + key;
    setPin(nextPin);
    setErrorMsg('');

    if (nextPin.length === 4) {
      try {
        const valid = await verifyMasterPin(nextPin);
        if (valid) {
          await unlockMaintenanceMode(nextPin).catch(() => {});
          setPin('');
          onSuccess();
        } else {
          Vibration.vibrate(200);
          const rem = attemptsLeft - 1;
          setAttemptsLeft(rem);
          setErrorMsg(rem > 0 ? `Incorrect PIN (${rem} attempts left)` : 'Access Denied');
          setPin('');
          if (rem <= 0) {
            setTimeout(onClose, 1000);
          }
        }
      } catch (_e) {
        setErrorMsg('Verification error');
        setPin('');
      }
    }
  };

  return (
    <>
      <Modal
        visible={visible && !recoveryOpen}
        transparent
        animationType="fade"
        onRequestClose={onClose}
      >
        <View style={styles.backdrop}>
          <View style={styles.card}>
            {/* Header */}
            <View style={styles.header}>
              <View style={styles.shieldIconBox}>
                <Icon name="shield-lock" size={28} color="#6C63FF" />
              </View>
              <Text style={styles.title}>{title}</Text>
              <Text style={styles.subtitle}>{subtitle}</Text>
            </View>

            {/* Error message */}
            <Text style={styles.errorText}>{errorMsg || ' '}</Text>

            {/* PIN Dots */}
            <View style={styles.dotsRow}>
              {[0, 1, 2, 3].map((idx) => {
                const filled = pin.length > idx;
                return (
                  <View
                    key={idx}
                    style={[styles.dot, filled && styles.dotFilled]}
                  />
                );
              })}
            </View>

            {/* Keypad */}
            <View style={styles.keypad}>
              {[
                ['1', '2', '3'],
                ['4', '5', '6'],
                ['7', '8', '9'],
                ['cancel', '0', 'back'],
              ].map((row, rIdx) => (
                <View key={rIdx} style={styles.keypadRow}>
                  {row.map((btn) => {
                    if (btn === 'cancel') {
                      return (
                        <TouchableOpacity
                          key={btn}
                          style={[styles.keyBtn, styles.keyBtnSpecial]}
                          onPress={onClose}
                          activeOpacity={0.7}
                        >
                          <Text style={styles.cancelKeyText}>Cancel</Text>
                        </TouchableOpacity>
                      );
                    }
                    if (btn === 'back') {
                      return (
                        <TouchableOpacity
                          key={btn}
                          style={[styles.keyBtn, styles.keyBtnSpecial]}
                          onPress={() => handleKeyPress('back')}
                          activeOpacity={0.7}
                        >
                          <Icon name="backspace-outline" size={22} color="#CBD5E1" />
                        </TouchableOpacity>
                      );
                    }
                    return (
                      <TouchableOpacity
                        key={btn}
                        style={styles.keyBtn}
                        onPress={() => handleKeyPress(btn)}
                        activeOpacity={0.7}
                      >
                        <Text style={styles.keyText}>{btn}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ))}
            </View>

            {/* Forgot PIN button */}
            <TouchableOpacity
              style={styles.forgotBtn}
              onPress={() => setRecoveryOpen(true)}
              activeOpacity={0.7}
            >
              <Icon name="help-circle-outline" size={15} color="#6C63FF" style={{ marginRight: 4 }} />
              <Text style={styles.forgotBtnText}>Forgot Master PIN?</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Parent Account Recovery Modal */}
      <ParentRecoveryModal
        visible={recoveryOpen}
        onClose={() => setRecoveryOpen(false)}
        onSuccess={() => {
          setRecoveryOpen(false);
          onSuccess();
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(10, 14, 26, 0.88)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.lg,
  },
  card: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: '#111827',
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    paddingVertical: 24,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: 10,
  },
  shieldIconBox: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(108, 99, 255, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 12,
    color: '#94A3B8',
    textAlign: 'center',
    paddingHorizontal: 12,
  },
  errorText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#EF4444',
    height: 20,
    marginVertical: 4,
  },
  dotsRow: {
    flexDirection: 'row',
    gap: 16,
    marginVertical: 12,
  },
  dot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#1E293B',
    borderWidth: 1.5,
    borderColor: '#475569',
  },
  dotFilled: {
    backgroundColor: '#6C63FF',
    borderColor: '#6C63FF',
  },
  keypad: {
    width: '100%',
    paddingHorizontal: 10,
    marginVertical: 10,
  },
  keypadRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: 6,
  },
  keyBtn: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#334155',
    justifyContent: 'center',
    alignItems: 'center',
  },
  keyBtnSpecial: {
    backgroundColor: 'transparent',
    borderWidth: 0,
  },
  keyText: {
    fontSize: 22,
    fontWeight: '700',
    color: '#fff',
  },
  cancelKeyText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#EF4444',
  },
  forgotBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  forgotBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6C63FF',
  },
});
