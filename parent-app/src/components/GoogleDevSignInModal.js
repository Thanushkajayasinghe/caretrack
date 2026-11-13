import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, Modal, TouchableOpacity, TextInput,
  ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons as Icon } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';
import { Colors, Fonts, Spacing, Radius } from '../theme/tokens';

function GoogleLogo({ size = 24 }) {
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

export default function GoogleDevSignInModal({
  visible,
  onSignIn,
  onClose,
  initialEmail = '',
  initialName = '',
  loading = false,
}) {
  const [email, setEmail] = useState(initialEmail || '');
  const [name, setName] = useState(initialName || '');
  const [error, setError] = useState('');

  useEffect(() => {
    if (visible) {
      if (initialEmail) setEmail(initialEmail);
      if (initialName) setName(initialName);
      setError('');
    }
  }, [visible, initialEmail, initialName]);

  const handleConfirm = () => {
    setError('');
    const cleanEmail = (email || '').trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      setError('Please enter a valid Gmail address.');
      return;
    }
    if (onSignIn) {
      onSignIn({
        email: cleanEmail,
        name: name.trim() || cleanEmail.split('@')[0],
      });
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
          {/* Header Icon */}
          <View style={styles.iconCircle}>
            <GoogleLogo size={32} />
          </View>

          <Text style={styles.title}>Sign in with Google</Text>
          <Text style={styles.subtitle}>
            Enter your Gmail address to sign in or link your existing account.
          </Text>

          {/* Error Banner */}
          {error ? (
            <View style={styles.errorBox}>
              <Icon name="alert-circle-outline" size={16} color={Colors.status.danger} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {/* Email Input */}
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Gmail Address</Text>
            <View style={styles.inputWrapper}>
              <Icon name="mail-outline" size={18} color="#8B9CB8" style={styles.inputLeadIcon} />
              <TextInput
                style={styles.textInput}
                value={email}
                onChangeText={(val) => {
                  setEmail(val);
                  if (error) setError('');
                }}
                placeholder="example@gmail.com"
                placeholderTextColor="#5A6B88"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus={true}
              />
            </View>
          </View>

          {/* Display Name Input */}
          <View style={[styles.inputGroup, { marginTop: 12 }]}>
            <Text style={styles.inputLabel}>Display Name (optional)</Text>
            <View style={styles.inputWrapper}>
              <Icon name="person-outline" size={18} color="#8B9CB8" style={styles.inputLeadIcon} />
              <TextInput
                style={styles.textInput}
                value={name}
                onChangeText={setName}
                placeholder="John Doe"
                placeholderTextColor="#5A6B88"
                autoCapitalize="words"
              />
            </View>
          </View>

          {/* Info note */}
          <View style={styles.infoBox}>
            <Icon name="information-circle-outline" size={16} color="#60A5FA" />
            <Text style={styles.infoText}>
              If this email was already registered, CareTrack will automatically link it to your account without losing any data.
            </Text>
          </View>

          {/* Action Button */}
          <TouchableOpacity
            style={styles.submitBtn}
            onPress={handleConfirm}
            disabled={loading}
            activeOpacity={0.85}
          >
            <LinearGradient
              colors={['#4285F4', '#3367D6']}
              style={styles.btnGradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
            >
              {loading ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <>
                  <GoogleLogo size={18} />
                  <Text style={styles.btnText}>Continue with Google</Text>
                </>
              )}
            </LinearGradient>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.cancelBtn}
            onPress={onClose}
            disabled={loading}
            activeOpacity={0.7}
          >
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(5, 7, 14, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xl,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#0D1324',
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    padding: Spacing.xl,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 15,
  },
  iconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 4,
  },
  title: {
    fontFamily: Fonts.bold,
    fontSize: 20,
    color: '#F8FAFC',
    textAlign: 'center',
    marginBottom: 6,
  },
  subtitle: {
    fontFamily: Fonts.regular,
    fontSize: 13,
    color: '#94A3B8',
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: Spacing.lg,
    paddingHorizontal: Spacing.sm,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
    borderRadius: Radius.md,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: Spacing.md,
    width: '100%',
    gap: 8,
  },
  errorText: {
    fontFamily: Fonts.regular,
    fontSize: 12,
    color: Colors.status.danger,
    flex: 1,
  },
  inputGroup: {
    width: '100%',
  },
  inputLabel: {
    fontFamily: Fonts.medium,
    fontSize: 13,
    color: '#CBD5E1',
    marginBottom: 6,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.8)',
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.2)',
    borderRadius: Radius.md,
    paddingHorizontal: 12,
    height: 48,
  },
  inputLeadIcon: {
    marginRight: 10,
  },
  textInput: {
    flex: 1,
    fontFamily: Fonts.regular,
    fontSize: 15,
    color: '#FFFFFF',
    paddingVertical: 0,
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.25)',
    borderRadius: Radius.md,
    padding: 10,
    marginTop: 14,
    width: '100%',
    gap: 8,
  },
  infoText: {
    fontFamily: Fonts.regular,
    fontSize: 11,
    color: '#93C5FD',
    flex: 1,
    lineHeight: 16,
  },
  submitBtn: {
    width: '100%',
    height: 48,
    borderRadius: Radius.md,
    overflow: 'hidden',
    marginTop: Spacing.xl,
  },
  btnGradient: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  btnText: {
    fontFamily: Fonts.semiBold,
    fontSize: 15,
    color: '#FFFFFF',
  },
  cancelBtn: {
    marginTop: Spacing.md,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  cancelBtnText: {
    fontFamily: Fonts.medium,
    fontSize: 13,
    color: '#94A3B8',
  },
});
