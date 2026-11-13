import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, ScrollView, Animated, ActivityIndicator,
  Dimensions, Platform, Alert, StatusBar, Image,
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

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('screen');
const CARD_TOP = Math.round((SCREEN_HEIGHT * 334) / 1024);
const CARD_HEIGHT = Math.round((SCREEN_HEIGHT * 504) / 1024);
const CARD_MARGIN_H = Math.round((SCREEN_WIDTH * 25) / 472);
const FOOTER_SPACE = Math.round((SCREEN_HEIGHT * 186) / 1024);

// Multi-color Google 'G' icon component
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

export default function LoginScreen({ navigation, onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
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
  const slideAnim = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 500, useNativeDriver: true }),
    ]).start();

    AsyncStorage.getItem('rememberEmail').then(savedEmail => {
      if (savedEmail) {
        setEmail(savedEmail);
        setRememberMe(true);
      }
    }).catch(() => {});
  }, []);

  const shake = () => {
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 10, duration: 80, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 80, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 10, duration: 80, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 80, useNativeDriver: true }),
    ]).start();
  };

  const handleLogin = async () => {
    setError('');
    if (!email || !password) {
      setError('Please fill in all fields');
      shake();
      return;
    }

    setLoading(true);
    try {
      const cleanEmail = email.trim().toLowerCase();
      const { data } = await authAPI.login({ email: cleanEmail, password });

      if (rememberMe) {
        await AsyncStorage.setItem('rememberEmail', cleanEmail);
      } else {
        await AsyncStorage.removeItem('rememberEmail');
      }

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
      const msg = data?.error || err.message || 'Login failed. Try again.';
      setError(msg);
      shake();

      if (!status || msg.toLowerCase().includes('network') || msg.toLowerCase().includes('timeout')) {
        Alert.alert(
          'Connection Error',
          `${msg}\n\nTip: If you are using a physical phone, tap the ⚙️ gear icon in the top right to verify your backend address (e.g. 192.168.1.8:3000).`
        );
      }
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = () => {
    Alert.alert(
      'Forgot Password',
      'Please contact administrator or check your email instructions to reset your password.',
      [{ text: 'OK' }]
    );
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

  const topPadding = Platform.OS === 'android' ? (StatusBar.currentHeight || 24) : 40;

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      {/* Unified Full-Screen Seamless Background */}
      <Image
        source={require('../../assets/login_bg_v2.png')}
        style={styles.backgroundImage}
        resizeMode="stretch"
      />

      {/* Top Settings Button */}
      <TouchableOpacity
        onPress={() => setSettingsOpen(true)}
        style={[styles.settingsBtn, { top: topPadding }]}
        activeOpacity={0.8}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      >
        <Icon name="settings-outline" size={16} color="#A5B4FC" />
      </TouchableOpacity>

      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          {/* Top spacer: reveals the CareTrack header, sunset, mother & child */}
          <View style={{ height: CARD_TOP }} />

          {/* Glassmorphic Login Card */}
          <Animated.View
            style={[
              styles.cardWrapper,
              { opacity: fadeAnim, transform: [{ translateY: slideAnim }, { translateX: shakeAnim }] },
            ]}
          >
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Welcome back 👋</Text>
              <Text style={styles.cardSubtitle}>Sign in to your account</Text>

              {/* Email Input */}
              <View style={styles.inputCard}>
                <Icon name="mail-outline" size={20} color="#8B9CB8" style={styles.inputLeadIcon} />
                <View style={styles.inputTextContainer}>
                  <Text style={styles.inputFloatingLabel}>Email</Text>
                  <TextInput
                    style={styles.textInput}
                    value={email}
                    onChangeText={setEmail}
                    placeholder="you@example.com"
                    placeholderTextColor="#5A6B88"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>
              </View>

              {/* Password Input */}
              <View style={[styles.inputCard, { marginTop: 12 }]}>
                <Icon name="lock-closed-outline" size={20} color="#8B9CB8" style={styles.inputLeadIcon} />
                <View style={styles.inputTextContainer}>
                  <Text style={styles.inputFloatingLabel}>Password</Text>
                  <TextInput
                    style={styles.textInput}
                    value={password}
                    onChangeText={setPassword}
                    placeholder="••••••••"
                    placeholderTextColor="#5A6B88"
                    secureTextEntry={!showPass}
                    autoCapitalize="none"
                  />
                </View>
                <TouchableOpacity
                  onPress={() => setShowPass(!showPass)}
                  style={styles.eyeBtn}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Icon
                    name={showPass ? 'eye-outline' : 'eye-off-outline'}
                    size={20}
                    color="#8B9CB8"
                  />
                </TouchableOpacity>
              </View>

              {/* Remember me & Forgot password */}
              <View style={styles.optionsRow}>
                <TouchableOpacity
                  style={styles.rememberMeContainer}
                  onPress={() => setRememberMe(!rememberMe)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.checkbox, rememberMe && styles.checkboxActive]}>
                    {rememberMe && <Icon name="checkmark" size={13} color="#FFFFFF" />}
                  </View>
                  <Text style={styles.rememberMeText}>Remember me</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={handleForgotPassword}
                  activeOpacity={0.7}
                >
                  <Text style={styles.forgotPassText}>Forgot password?</Text>
                </TouchableOpacity>
              </View>

              {/* Error Box */}
              {error ? (
                <View style={styles.errorBox}>
                  <Icon name="alert-circle-outline" size={16} color={Colors.status.danger} />
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              ) : null}

              {/* Sign In Button with Blue & Purple mixed gradient */}
              <TouchableOpacity
                onPress={handleLogin}
                disabled={loading}
                activeOpacity={0.88}
                style={styles.signInBtnWrapper}
              >
                <LinearGradient
                  colors={['#615BFC', '#715BFB', '#8657F9']}
                  style={styles.signInBtn}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                >
                  {loading ? (
                    <ActivityIndicator color="#FFFFFF" size="small" />
                  ) : (
                    <>
                      <Text style={styles.signInBtnText}>Sign in</Text>
                      <Icon name="arrow-forward" size={18} color="#FFFFFF" />
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

              {/* Social Login: Continue with Google */}
              <TouchableOpacity
                onPress={handleGoogleSignIn}
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

              {/* Register Link */}
              <TouchableOpacity
                onPress={() => navigation.navigate('Register')}
                style={styles.registerLink}
                activeOpacity={0.7}
              >
                <Text style={styles.registerText}>
                  Don't have an account?{' '}
                  <Text style={styles.registerHighlight}>Create one</Text>
                </Text>
              </TouchableOpacity>
            </View>
          </Animated.View>

          {/* Bottom spacer: ensures rolling hills & 3 badges are comfortably visible */}
          <View style={{ height: FOOTER_SPACE }} />
        </ScrollView>
      </KeyboardAvoidingView>

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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#11153D',
  },
  backgroundImage: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },

  settingsBtn: {
    position: 'absolute',
    right: 8,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(21, 30, 64, 0.75)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(100, 115, 215, 0.4)',
    zIndex: 50,
  },

  /* Card */
  cardWrapper: {
    paddingHorizontal: CARD_MARGIN_H,
    marginTop: 0,
    marginBottom: 0,
  },
  card: {
    backgroundColor: 'rgba(13, 18, 46, 0.72)',
    borderRadius: 24,
    height: CARD_HEIGHT,
    paddingHorizontal: 16,
    paddingVertical: 14,
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: 'rgba(95, 110, 210, 0.38)',
    shadowColor: '#070A1E',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 14,
    elevation: 6,
  },
  cardTitle: {
    fontFamily: Fonts.bold,
    fontSize: 20,
    color: '#FFFFFF',
    marginBottom: 2,
  },
  cardSubtitle: {
    fontFamily: Fonts.regular,
    fontSize: 12.5,
    color: '#8E9BB5',
    marginBottom: 10,
  },

  /* Floating Input Field */
  inputCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(23, 31, 64, 0.75)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(65, 85, 150, 0.35)',
    paddingHorizontal: 13,
    paddingVertical: 3,
    minHeight: 46,
  },
  inputLeadIcon: {
    marginRight: 9,
  },
  inputTextContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  inputFloatingLabel: {
    fontFamily: Fonts.medium,
    fontSize: 10,
    color: '#8E9BB5',
    marginBottom: 1,
  },
  textInput: {
    fontFamily: Fonts.regular,
    fontSize: 13,
    color: '#FFFFFF',
    padding: 0,
    margin: 0,
  },
  eyeBtn: {
    padding: 6,
    marginLeft: 4,
  },

  /* Options Row */
  optionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 10,
  },
  rememberMeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: 'rgba(86, 102, 175, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 7,
  },
  checkboxActive: {
    backgroundColor: '#615BFC',
    borderColor: '#615BFC',
  },
  rememberMeText: {
    fontFamily: Fonts.regular,
    fontSize: 12.5,
    color: '#8E9BB5',
  },
  forgotPassText: {
    fontFamily: Fonts.semiBold,
    fontSize: 12.5,
    color: '#9B8AFB',
  },

  /* Error Box */
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: `${Colors.status.danger}18`,
    borderRadius: Radius.sm,
    padding: Spacing.sm,
    marginBottom: 10,
    gap: 6,
  },
  errorText: {
    fontFamily: Fonts.regular,
    fontSize: 12.5,
    color: Colors.status.danger,
    flex: 1,
  },

  /* Sign In Button */
  signInBtnWrapper: {
    shadowColor: '#615BFC',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 6,
  },
  signInBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 46,
    borderRadius: 12,
    gap: 8,
  },
  signInBtnText: {
    fontFamily: Fonts.bold,
    fontSize: 15,
    color: '#FFFFFF',
  },

  /* OR Divider */
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 10,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(65, 85, 150, 0.25)',
  },
  dividerText: {
    fontFamily: Fonts.medium,
    fontSize: 11,
    color: '#68769E',
    marginHorizontal: 10,
  },

  /* Google Button */
  googleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(18, 25, 54, 0.82)',
    borderWidth: 1,
    borderColor: 'rgba(65, 85, 150, 0.35)',
    gap: 9,
  },
  googleBtnText: {
    fontFamily: Fonts.semiBold,
    fontSize: 13.5,
    color: '#FFFFFF',
  },

  /* Register Link */
  registerLink: {
    alignItems: 'center',
    marginTop: 10,
  },
  registerText: {
    fontFamily: Fonts.regular,
    fontSize: 12.5,
    color: '#8E9BB5',
  },
  registerHighlight: {
    color: '#9B8AFB',
    fontFamily: Fonts.bold,
  },
});
