import React, { useState, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, ScrollView, Animated, ActivityIndicator,
  Platform, Alert,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons as Icon } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';
import { Colors, Fonts, Spacing, Radius } from '../../theme/tokens';
import { authAPI } from '../../services/api';
import ServerSettingsModal from '../Settings/ServerSettingsModal';
import CompleteProfileModal from '../../components/CompleteProfileModal';
import GoogleDevSignInModal from '../../components/GoogleDevSignInModal';
import { promptGoogleSignIn, authenticateWithBackend } from '../../services/googleAuth';

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

export default function RegisterScreen({ navigation, onLogin }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [showConfirmPass, setShowConfirmPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [showDevGoogleModal, setShowDevGoogleModal] = useState(false);
  const [showCompleteProfile, setShowCompleteProfile] = useState(false);
  const [pendingParent, setPendingParent] = useState(null);
  const [profileSaving, setProfileSaving] = useState(false);

  const shakeAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }).start();
  }, []);

  const shake = () => {
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 8, duration: 70, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -8, duration: 70, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 8, duration: 70, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 70, useNativeDriver: true }),
    ]).start();
  };

  const handleRegister = async () => {
    setError('');
    if (!name.trim() || !email.trim() || !password) {
      setError('Please fill in name, email, and password');
      shake();
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      shake();
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      shake();
      return;
    }

    setLoading(true);
    try {
      const { data } = await authAPI.register({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        phone: phone.trim() || undefined,
        password,
      });
      await AsyncStorage.multiSet([
        ['accessToken', data.accessToken],
        ['refreshToken', data.refreshToken],
        ['parentId', data.parent.id],
        ['parentName', data.parent.name],
        ['parentEmail', data.parent.email],
      ]);
      onLogin();
    } catch (err) {
      const status = err.response?.status;
      const data = err.response?.data;
      let msg = data?.error || data?.message;
      if (!msg && data?.issues?.length) {
        msg = data.issues.map((i) => i.message || `${i.path?.join?.('.') || i.path}: invalid`).join(', ');
      }
      if (!msg) {
        msg = err.message || 'Registration failed.';
      }
      setError(msg);
      shake();

      const isEmailConflict =
        status === 409 ||
        msg.toLowerCase().includes('already registered') ||
        msg.toLowerCase().includes('already exist');

      if (isEmailConflict) {
        Alert.alert(
          'Email Already Registered',
          `The email "${email.trim()}" is already in use. Please sign in or use a different email.`,
          [
            {
              text: 'Go to Login',
              onPress: () => navigation.navigate('Login'),
            },
            {
              text: 'Try Another Email',
              style: 'cancel',
            },
          ]
        );
      } else {
        const isNetworkErr = !status || msg.toLowerCase().includes('network') || msg.toLowerCase().includes('timeout') || msg.toLowerCase().includes('failed');
        Alert.alert(
          'Registration Failed',
          isNetworkErr
            ? `${msg}\n\nTip: If you are using a physical phone, tap the ⚙️ gear icon in the top right to verify your backend address (e.g. 192.168.1.8:3000).`
            : msg
        );
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError('');
    setGoogleLoading(true);
    try {
      const res = await promptGoogleSignIn();
      if (res?.parent) {
        handleGoogleSuccess(res);
      }
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Google sign-in failed.';
      setError(msg);
      shake();
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleDevGoogleSubmit = async ({ email: enteredEmail, name: enteredName }) => {
    setGoogleLoading(true);
    try {
      const syntheticGoogleId = 'google_' + enteredEmail.replace(/[^a-zA-Z0-9]/g, '_');
      const res = await authenticateWithBackend({
        email: enteredEmail,
        name: enteredName,
        googleId: syntheticGoogleId,
      });
      setShowDevGoogleModal(false);
      handleGoogleSuccess(res);
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Google sign-in failed.';
      setError(msg);
      shake();
      setShowDevGoogleModal(false);
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleGoogleSuccess = (res) => {
    if (res.isProfileComplete && res.parent?.phone) {
      onLogin();
    } else {
      setPendingParent(res.parent);
      setShowCompleteProfile(true);
    }
  };

  const handleSaveProfile = async ({ name: updatedName, phone: updatedPhone }) => {
    setProfileSaving(true);
    try {
      const { data } = await authAPI.updateProfile({ name: updatedName, phone: updatedPhone });
      if (data?.parent) {
        await AsyncStorage.multiSet([
          ['parentName', data.parent.name || ''],
          ['parentPhone', data.parent.phone || ''],
        ]);
      }
      setShowCompleteProfile(false);
      onLogin();
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Failed to update profile.';
      Alert.alert('Update Failed', msg);
    } finally {
      setProfileSaving(false);
    }
  };

  const handleSkipProfile = () => {
    setShowCompleteProfile(false);
    onLogin();
  };

  const StrengthBar = () => {
    const strength = password.length >= 12 ? 3 : password.length >= 8 ? 2 : password.length >= 4 ? 1 : 0;
    const colors = ['#EF4444', '#F59E0B', '#10B981'];
    const labels = ['Weak', 'Fair', 'Strong'];
    return password.length > 0 ? (
      <View style={{ flexDirection: 'row', gap: 4, marginTop: 6, alignItems: 'center' }}>
        {[0, 1, 2].map((i) => (
          <View
            key={i}
            style={{
              flex: 1,
              height: 3,
              borderRadius: 2,
              backgroundColor: i < strength ? colors[strength - 1] : Colors.bg.tertiary,
            }}
          />
        ))}
        <Text style={{ fontFamily: Fonts.medium, fontSize: 10, color: strength > 0 ? colors[strength - 1] : Colors.text.tertiary, marginLeft: 6 }}>
          {strength > 0 ? labels[strength - 1] : ''}
        </Text>
      </View>
    ) : null;
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <LinearGradient
        colors={['#0A0E1A', '#111827', '#0F1729']}
        style={StyleSheet.absoluteFill}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      />
      <View style={styles.orb1} />
      <View style={styles.orb2} />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Animated.View style={[styles.content, { opacity: fadeAnim }]}>
          {/* Header */}
          <View style={styles.topRow}>
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
              <Icon name="arrow-back" size={22} color={Colors.text.secondary} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setSettingsOpen(true)} style={styles.settingsBtn}>
              <Icon name="settings-outline" size={20} color={Colors.brand.primary} />
            </TouchableOpacity>
          </View>

          <View style={styles.logoArea}>
            <LinearGradient
              colors={[Colors.brand.primary, '#8B5CF6']}
              style={styles.logoCircle}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            >
              <Icon name="shield-checkmark" size={32} color="#FFFFFF" />
            </LinearGradient>
            <Text style={styles.logoTitle}>Create account</Text>
            <Text style={styles.logoSubtitle}>Start protecting your family</Text>
          </View>

          <Animated.View style={[styles.card, { transform: [{ translateX: shakeAnim }] }]}>
            {/* Name */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Full Name</Text>
              <View style={styles.inputWrapper}>
                <Icon name="person-outline" size={18} color={Colors.text.tertiary} style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  value={name}
                  onChangeText={setName}
                  placeholder="Your name"
                  placeholderTextColor={Colors.text.tertiary}
                  autoCapitalize="words"
                />
              </View>
            </View>

            {/* Phone */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Phone Number</Text>
              <View style={styles.inputWrapper}>
                <Icon name="call-outline" size={18} color={Colors.text.tertiary} style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  value={phone}
                  onChangeText={setPhone}
                  placeholder="+1 (555) 000-0000"
                  placeholderTextColor={Colors.text.tertiary}
                  keyboardType="phone-pad"
                  autoCapitalize="none"
                />
              </View>
            </View>

            {/* Email */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Email</Text>
              <View style={styles.inputWrapper}>
                <Icon name="mail-outline" size={18} color={Colors.text.tertiary} style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  value={email}
                  onChangeText={setEmail}
                  placeholder="you@example.com"
                  placeholderTextColor={Colors.text.tertiary}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
              </View>
            </View>

            {/* Password */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Password</Text>
              <View style={styles.inputWrapper}>
                <Icon name="lock-closed-outline" size={18} color={Colors.text.tertiary} style={styles.inputIcon} />
                <TextInput
                  style={[styles.input, styles.inputPassword]}
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Min. 8 characters"
                  placeholderTextColor={Colors.text.tertiary}
                  secureTextEntry={!showPass}
                  autoCapitalize="none"
                />
                <TouchableOpacity onPress={() => setShowPass(!showPass)} style={styles.eyeBtn}>
                  <Icon name={showPass ? 'eye-outline' : 'eye-off-outline'} size={18} color={Colors.text.tertiary} />
                </TouchableOpacity>
              </View>
              <StrengthBar />
            </View>

            {/* Confirm Password */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Confirm Password</Text>
              <View style={styles.inputWrapper}>
                <Icon name="shield-checkmark-outline" size={18} color={Colors.text.tertiary} style={styles.inputIcon} />
                <TextInput
                  style={[styles.input, styles.inputPassword]}
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  placeholder="Re-enter password"
                  placeholderTextColor={Colors.text.tertiary}
                  secureTextEntry={!showConfirmPass}
                  autoCapitalize="none"
                />
                <TouchableOpacity onPress={() => setShowConfirmPass(!showConfirmPass)} style={styles.eyeBtn}>
                  <Icon name={showConfirmPass ? 'eye-outline' : 'eye-off-outline'} size={18} color={Colors.text.tertiary} />
                </TouchableOpacity>
              </View>
            </View>

            {error ? (
              <View style={styles.errorBox}>
                <Icon name="alert-circle-outline" size={14} color={Colors.status.danger} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            <TouchableOpacity onPress={handleRegister} disabled={loading || googleLoading} activeOpacity={0.85} style={styles.btnWrapper}>
              <LinearGradient
                colors={[Colors.brand.primary, '#8B5CF6']}
                style={styles.btn}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Text style={styles.btnText}>Create Account</Text>
                    <Icon name="checkmark" size={18} color="#fff" />
                  </>
                )}
              </LinearGradient>
            </TouchableOpacity>

            {/* OR Divider */}
            <View style={styles.dividerRow}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>OR</Text>
              <View style={styles.dividerLine} />
            </View>

            {/* Continue with Google */}
            <TouchableOpacity
              onPress={handleGoogleSignIn}
              onLongPress={() => setShowDevGoogleModal(true)}
              disabled={loading || googleLoading}
              activeOpacity={0.8}
              style={styles.googleBtn}
            >
              {googleLoading ? (
                <ActivityIndicator size="small" color="#4285F4" />
              ) : (
                <>
                  <GoogleLogo size={20} />
                  <Text style={styles.googleBtnText}>Continue with Google</Text>
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity onPress={() => navigation.navigate('Login')} style={styles.loginLink} activeOpacity={0.7}>
              <Text style={styles.loginText}>
                Already have an account?{' '}
                <Text style={styles.loginHighlight}>Sign in</Text>
              </Text>
            </TouchableOpacity>
          </Animated.View>
        </Animated.View>
      </ScrollView>

      <ServerSettingsModal
        visible={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />




      <CompleteProfileModal
        visible={showCompleteProfile}
        initialName={pendingParent?.name || ''}
        initialPhone={pendingParent?.phone || ''}
        loading={profileSaving}
        onSave={handleSaveProfile}
        onSkip={handleSkipProfile}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { flexGrow: 1, justifyContent: 'center' },
  content: { flex: 1, justifyContent: 'center', paddingHorizontal: Spacing.xl, paddingVertical: Spacing.section },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.xl },
  backBtn: { width: 44, height: 44, justifyContent: 'center' },
  settingsBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(108, 99, 255, 0.15)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(108, 99, 255, 0.3)',
  },
  orb1: { position: 'absolute', top: -80, right: -60, width: 260, height: 260, borderRadius: 130, backgroundColor: `${Colors.brand.primary}18` },
  orb2: { position: 'absolute', bottom: -100, left: -80, width: 300, height: 300, borderRadius: 150, backgroundColor: `${Colors.brand.secondary}12` },
  logoArea: { alignItems: 'center', marginBottom: Spacing.xxl },
  logoCircle: { width: 68, height: 68, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.md, shadowColor: Colors.brand.primary, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.4, shadowRadius: 16, elevation: 10 },
  logoTitle: { fontFamily: Fonts.bold, fontSize: Fonts.sizes.xxl, color: Colors.text.primary },
  logoSubtitle: { fontFamily: Fonts.regular, fontSize: Fonts.sizes.sm, color: Colors.text.tertiary, marginTop: 4 },
  card: { backgroundColor: Colors.bg.secondary, borderRadius: Radius.xxl, padding: Spacing.xxl, borderWidth: 1, borderColor: Colors.bg.glassBorder },
  inputGroup: { marginBottom: Spacing.lg },
  label: { fontFamily: Fonts.medium, fontSize: Fonts.sizes.sm, color: Colors.text.secondary, marginBottom: Spacing.xs },
  inputWrapper: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.bg.tertiary, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.bg.glassBorder, paddingHorizontal: Spacing.md, height: 52 },
  inputIcon: { marginRight: Spacing.sm },
  input: { flex: 1, fontFamily: Fonts.regular, fontSize: Fonts.sizes.md, color: Colors.text.primary, height: '100%' },
  inputPassword: { paddingRight: 40 },
  eyeBtn: { position: 'absolute', right: Spacing.md, height: '100%', justifyContent: 'center' },
  errorBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: `${Colors.status.danger}18`, borderRadius: Radius.sm, padding: Spacing.sm, marginBottom: Spacing.md, gap: 6 },
  errorText: { fontFamily: Fonts.regular, fontSize: Fonts.sizes.sm, color: Colors.status.danger, flex: 1 },
  btnWrapper: { marginTop: Spacing.md },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 54, borderRadius: Radius.lg, gap: 8 },
  btnText: { fontFamily: Fonts.semiBold, fontSize: Fonts.sizes.md, color: '#FFFFFF' },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: Spacing.lg,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
  },
  dividerText: {
    fontFamily: Fonts.medium,
    fontSize: 12,
    color: '#8B9CB8',
    paddingHorizontal: 12,
  },
  googleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: Radius.lg,
    height: 52,
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  googleBtnText: {
    fontFamily: Fonts.semiBold,
    fontSize: 15,
    color: '#1F2937',
  },
  loginLink: { alignItems: 'center', marginTop: Spacing.xl },
  loginText: { fontFamily: Fonts.regular, fontSize: Fonts.sizes.sm, color: Colors.text.secondary },
  loginHighlight: { color: Colors.brand.primary, fontFamily: Fonts.semiBold },
});
