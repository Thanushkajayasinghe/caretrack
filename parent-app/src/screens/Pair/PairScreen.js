import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  Animated, ScrollView, ActivityIndicator, Dimensions, Alert,
  StatusBar, Platform, Image,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons as Icon } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { Colors, Fonts, Spacing, Radius } from '../../theme/tokens';
import { pairAPI, childAPI } from '../../services/api';
import { onChildPaired, offChildPaired } from '../../services/socket';
import { getServerUrl } from '../../config/server';
import { PRESET_AVATARS, getAvatarUriById } from '../../constants/presetAvatars';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const QR_SIZE = SCREEN_WIDTH * 0.62;
const PAIRING_DURATION = 300; // seconds

export default function PairScreen({ navigation }) {
  const [children, setChildren] = useState([]);
  const [childName, setChildName] = useState('');
  const [selectedChildId, setSelectedChildId] = useState(null);
  const [selectedAvatar, setSelectedAvatar] = useState('boy_blue');
  const [customAvatarUri, setCustomAvatarUri] = useState(null);
  const [session, setSession] = useState(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState('select'); // 'select' | 'pairing' | 'success'

  const timerRef = useRef(null);
  const pollTimerRef = useRef(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.95)).current;
  const successAnim = useRef(new Animated.Value(0)).current;
  const progressAnim = useRef(new Animated.Value(1)).current;

  useFocusEffect(useCallback(() => {
    loadChildren();
    return () => {
      clearInterval(timerRef.current);
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, []));

  const handlePairSuccess = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    setStep('success');
    Animated.parallel([
      Animated.spring(successAnim, { toValue: 1, useNativeDriver: true, tension: 60, friction: 6 }),
    ]).start();
    loadChildren();
  };

  useEffect(() => {
    const handler = (data) => {
      console.log('Parent received child_paired event:', data);
      if (!session || data.childId === session?.childId) {
        handlePairSuccess();
      }
    };
    onChildPaired(handler);
    return () => offChildPaired(handler);
  }, [session]);

  // Polling fallback
  useEffect(() => {
    if (step === 'pairing' && session?.sessionId) {
      pollTimerRef.current = setInterval(async () => {
        try {
          const { data } = await pairAPI.status(session.sessionId);
          if (data?.claimed) {
            console.log('✅ Polling verified device pairing claimed!');
            handlePairSuccess();
          }
        } catch (_err) {
          // ignore transient errors
        }
      }, 2000);
    }
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [step, session]);

  const loadChildren = async () => {
    try {
      const { data } = await childAPI.list();
      const fetched = data?.children || [];
      setChildren(fetched);
      setSelectedChildId((prev) => (fetched.some((c) => c.id === prev) ? prev : null));
    } catch (err) {
      console.warn('Failed to load children:', err?.message);
    }
  };

  const promptPickImage = () => {
    Alert.alert(
      'Upload Child Photo',
      'Choose a photo for your child:',
      [
        { text: 'Choose from Gallery', onPress: () => pickImage('gallery') },
        { text: 'Take Photo', onPress: () => pickImage('camera') },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  };

  const pickImage = async (type) => {
    try {
      const pickerFn = type === 'camera' ? launchCamera : launchImageLibrary;
      if (typeof pickerFn !== 'function') {
        Alert.alert('Unavailable', 'Image picker module is not ready on this device.');
        return;
      }

      const options = {
        mediaType: 'photo',
        maxWidth: 400,
        maxHeight: 400,
        quality: 0.85,
        includeBase64: true,
      };

      const result = await pickerFn(options);
      if (result.didCancel || !result.assets || result.assets.length === 0) return;

      const asset = result.assets[0];
      if (!asset.base64) {
        Alert.alert('Upload Error', 'Could not read image data.');
        return;
      }

      const mimeType = asset.type || 'image/jpeg';
      const dataUri = `data:${mimeType};base64,${asset.base64}`;
      setCustomAvatarUri(dataUri);
      setSelectedAvatar('custom');
      setSelectedChildId(null);
    } catch (err) {
      console.error('Failed to pick avatar image:', err);
      Alert.alert('Image Error', 'Failed to pick image. Please try again.');
    }
  };

  const handleGeneratePress = () => {
    if (!selectedChildId && !childName.trim()) {
      Alert.alert(
        'Child Profile Required',
        'Please select an existing child profile above, or enter a name to create a new child.',
        [{ text: 'OK' }]
      );
      return;
    }
    generateSession();
  };

  const generateSession = async () => {
    setLoading(true);
    try {
      const payload = selectedChildId
        ? { childId: selectedChildId }
        : { childName: childName.trim() || 'My Child', avatar: selectedAvatar };

      const { data } = await pairAPI.generate(payload);
      setSession(data);
      setTimeLeft(PAIRING_DURATION);
      setStep('pairing');

      // Connect profile image API to persist selected/uploaded avatar to DB
      try {
        const targetChildId = data?.childId || selectedChildId;
        let avatarToSave = null;
        if (selectedAvatar === 'custom' && customAvatarUri) {
          avatarToSave = customAvatarUri;
        } else if (selectedAvatar) {
          avatarToSave = typeof getAvatarUriById === 'function' ? getAvatarUriById(selectedAvatar) : null;
        }

        if (targetChildId && avatarToSave) {
          await childAPI.updateAvatar(targetChildId, avatarToSave);
          console.log('✅ Child avatar saved to profile:', targetChildId);
        }
      } catch (avatarErr) {
        console.warn('Could not save avatar via childAPI:', avatarErr?.message);
      }

      Animated.timing(progressAnim, {
        toValue: 0,
        duration: PAIRING_DURATION * 1000,
        useNativeDriver: false,
      }).start();

      timerRef.current = setInterval(() => {
        setTimeLeft((t) => {
          if (t <= 1) {
            clearInterval(timerRef.current);
            setStep('select');
            setSession(null);
            progressAnim.setValue(1);
            return 0;
          }
          return t - 1;
        });
      }, 1000);

      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
        Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, tension: 80, friction: 8 }),
      ]).start();
    } catch (err) {
      console.error('Generate session error:', err);
      const msg = err.response?.data?.error || err.message || 'Cannot reach backend server.';
      Alert.alert('Pairing Error', msg);
    } finally {
      setLoading(false);
    }
  };

  const resetSession = () => {
    clearInterval(timerRef.current);
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    setSession(null);
    setStep('select');
    setSelectedChildId(null);
    setChildName('');
    setSelectedAvatar('boy_blue');
    setCustomAvatarUri(null);
    progressAnim.setValue(1);
    fadeAnim.setValue(0);
    scaleAnim.setValue(0.95);
    successAnim.setValue(0);
  };

  const formatTime = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  const topPadding = Platform.OS === 'android' ? (StatusBar.currentHeight || 24) : 44;

  // ── Success screen
  if (step === 'success') {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
        <LinearGradient colors={['#070A18', '#0D1432', '#070A18']} style={StyleSheet.absoluteFill} />
        <Animated.View style={[styles.successContainer, {
          opacity: successAnim,
          transform: [{ scale: successAnim.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) }],
        }]}>
          <LinearGradient colors={['#10B981', '#059669']} style={styles.successIcon}>
            <Icon name="checkmark" size={52} color="#fff" />
          </LinearGradient>
          <Text style={styles.successTitle}>Device Paired! 🎉</Text>
          <Text style={styles.successSub}>
            {session?.childName || 'Child'}'s device is now connected and monitoring has begun.
          </Text>
          <TouchableOpacity
            style={styles.successBtn}
            onPress={() => {
              resetSession();
              navigation?.navigate('HomeTab', { screen: 'Dashboard' });
            }}
            activeOpacity={0.85}
          >
            <LinearGradient colors={['#5B46F6', '#8B5CF6']} style={styles.successBtnGrad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
              <Text style={styles.successBtnText}>Go to Live Dashboard</Text>
            </LinearGradient>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.successBtn, { marginTop: 12, backgroundColor: 'rgba(21, 30, 64, 0.75)' }]}
            onPress={resetSession}
            activeOpacity={0.85}
          >
            <Text style={[styles.successBtnText, { color: '#8E9BB5' }]}>Pair Another Device</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    );
  }

  // ── Pairing active step (QR Display)
  if (step === 'pairing' && session) {
    const urgent = timeLeft < 60;
    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
        <LinearGradient colors={['#070A18', '#0D1533', '#070A18']} style={StyleSheet.absoluteFill} />

        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingTop: topPadding + 10 }]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.pairingHeader}>
            <TouchableOpacity onPress={resetSession} style={styles.backBtn} activeOpacity={0.7}>
              <Icon name="arrow-back" size={24} color="#A5B4FC" />
            </TouchableOpacity>
            <Text style={styles.pairingTitle}>Scan to Pair</Text>
            <View style={{ width: 36 }} />
          </View>

          <Animated.View style={[styles.qrCard, { opacity: fadeAnim, transform: [{ scale: scaleAnim }] }]}>
            <View style={styles.qrContainer}>
              <View style={[styles.qrBorder, { borderColor: urgent ? Colors.status.danger : '#6366F1' }]}>
                <QRCode
                  value={`${session.qrPayload}&server=${encodeURIComponent(getServerUrl())}`}
                  size={QR_SIZE - 48}
                  backgroundColor="#FFFFFF"
                  color="#000000"
                  quietZone={10}
                />
              </View>
            </View>

            {/* Progress bar */}
            <View style={styles.progressBarBg}>
              <Animated.View
                style={[
                  styles.progressBarFill,
                  {
                    backgroundColor: urgent ? Colors.status.danger : '#8B5CF6',
                    width: progressAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: ['0%', '100%'],
                    }),
                  },
                ]}
              />
            </View>

            {/* Countdown */}
            <View style={styles.countdownRow}>
              <Icon name="time-outline" size={16} color={urgent ? Colors.status.danger : '#8E9BB5'} />
              <Text style={[styles.countdownText, urgent && { color: Colors.status.danger }]}>
                {formatTime(timeLeft)}
              </Text>
            </View>

            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>or enter code manually</Text>
              <View style={styles.dividerLine} />
            </View>

            {/* 6-digit OTP */}
            <View style={styles.otpRow}>
              {session.otp.split('').map((digit, i) => (
                <View key={i} style={styles.otpDigit}>
                  <Text style={styles.otpDigitText}>{digit}</Text>
                </View>
              ))}
            </View>

            <Text style={styles.pairingHint}>
              Open CareTrack on the child's device, tap{' '}
              <Text style={{ color: '#A78BFA', fontFamily: Fonts.bold }}>"Pair with Parent"</Text>
              {' '}and scan this QR code or enter the 6-digit code above.
            </Text>

            <TouchableOpacity style={styles.refreshBtn} onPress={generateSession} disabled={loading} activeOpacity={0.8}>
              {loading ? (
                <ActivityIndicator size="small" color="#A78BFA" />
              ) : (
                <>
                  <Icon name="refresh" size={16} color="#A78BFA" />
                  <Text style={styles.refreshText}>Generate new code</Text>
                </>
              )}
            </TouchableOpacity>
          </Animated.View>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Header Art Illustration (Without Watch, fully blended with title & subtitle) */}
        <View style={styles.headerContainer}>
          <Image
            source={require('../../assets/pair_header_clean.png')}
            style={styles.headerImage}
            resizeMode="cover"
          />
        </View>

        {/* Section 1: EXISTING CHILDREN (Only shown when real children exist) */}
        {children.length > 0 && (
          <View style={styles.sectionContainer}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionHeaderLabel}>EXISTING CHILDREN</Text>
              <TouchableOpacity
                onPress={() => {
                  const firstId = children[0].id;
                  setSelectedChildId(selectedChildId === firstId ? null : firstId);
                  setChildName('');
                }}
                activeOpacity={0.7}
              >
                <Text style={styles.sectionHeaderAction}>
                  {selectedChildId ? 'Deselect' : 'Select ›'}
                </Text>
              </TouchableOpacity>
            </View>

            {children.map((child) => {
              const isSelected = selectedChildId === child.id;
              const initial = child.name ? child.name[0].toUpperCase() : 'C';

              return (
                <TouchableOpacity
                  key={child.id}
                  style={[
                    styles.childCard,
                    isSelected && styles.childCardSelected,
                  ]}
                  onPress={() => {
                    if (isSelected) {
                      setSelectedChildId(null);
                    } else {
                      setSelectedChildId(child.id);
                      setChildName('');
                      if (child.avatar_url) {
                        const preset = PRESET_AVATARS.find((p) => p.dataUri === child.avatar_url);
                        if (preset) {
                          setSelectedAvatar(preset.id);
                          setCustomAvatarUri(null);
                        } else {
                          setSelectedAvatar('custom');
                          setCustomAvatarUri(child.avatar_url);
                        }
                      }
                    }
                  }}
                  activeOpacity={0.8}
                >
                  <View style={styles.childAvatarBadge}>
                    {child.avatar_url ? (
                      <Image source={{ uri: child.avatar_url }} style={styles.childAvatarBadgeImg} resizeMode="cover" />
                    ) : (
                      <Text style={styles.childAvatarInitial}>{initial}</Text>
                    )}
                  </View>

                  <View style={styles.childInfoCol}>
                    <Text style={styles.childNameText}>{child.name}</Text>
                  </View>

                  <View style={[styles.chevronButton, isSelected && styles.chevronButtonSelected]}>
                    <Icon name={isSelected ? 'checkmark' : 'chevron-forward'} size={16} color="#FFFFFF" />
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* Section 2: CREATE CHILD PROFILE / OR CREATE NEW CHILD */}
        <View style={styles.sectionContainer}>
          <Text style={styles.sectionHeaderLabel}>
            {children.length > 0 ? 'OR CREATE NEW CHILD' : 'CREATE CHILD PROFILE'}
          </Text>

          {/* Child Name Input */}
          <View style={[styles.nameInputCard, selectedChildId && styles.nameInputDisabled]}>
            <Icon name="person-outline" size={20} color="#9D8EFF" style={styles.nameInputIcon} />
            <TextInput
              style={styles.nameTextInput}
              value={childName}
              onChangeText={(t) => {
                setChildName(t);
                setSelectedChildId(null);
              }}
              placeholder="Enter child's name"
              placeholderTextColor="#5A6B88"
              editable={!selectedChildId}
            />
          </View>

          {/* Subheading: CHOOSE AVATAR OR UPLOAD IMAGE */}
          <Text style={styles.avatarHeading}>CHOOSE AVATAR OR UPLOAD IMAGE</Text>

          {/* Child Avatars Row */}
          <View style={styles.avatarsRow}>
            {PRESET_AVATARS.map((av) => {
              const isSelected = selectedAvatar === av.id;
              return (
                <TouchableOpacity
                  key={av.id}
                  style={[
                    styles.avatarWrapper,
                    isSelected && styles.avatarWrapperSelected,
                  ]}
                  onPress={() => {
                    setSelectedAvatar(av.id);
                  }}
                  activeOpacity={0.8}
                >
                  <Image source={av.source} style={styles.avatarImg} resizeMode="cover" />
                </TouchableOpacity>
              );
            })}

            {/* Upload Image Button */}
            <TouchableOpacity
              style={styles.uploadWrapper}
              onPress={() => {
                if (customAvatarUri && selectedAvatar !== 'custom') {
                  setSelectedAvatar('custom');
                } else {
                  promptPickImage();
                }
              }}
              onLongPress={promptPickImage}
              activeOpacity={0.75}
            >
              <View
                style={[
                  styles.uploadBox,
                  selectedAvatar === 'custom' && styles.uploadBoxSelected,
                  customAvatarUri && { borderStyle: 'solid' },
                ]}
              >
                {customAvatarUri ? (
                  <>
                    <Image source={{ uri: customAvatarUri }} style={styles.avatarImg} resizeMode="cover" />
                    <View style={styles.uploadCameraBadge}>
                      <Icon name="camera" size={10} color="#FFFFFF" />
                    </View>
                  </>
                ) : (
                  <Icon name="cloud-upload-outline" size={24} color="#A78BFA" />
                )}
              </View>
              <Text
                style={[
                  styles.uploadBtnText,
                  selectedAvatar === 'custom' && styles.uploadBtnTextSelected,
                ]}
                numberOfLines={2}
              >
                Upload image
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Action Button: Generate QR Code */}
        <TouchableOpacity
          style={styles.generateBtn}
          onPress={handleGeneratePress}
          disabled={loading}
          activeOpacity={0.85}
        >
          <LinearGradient
            colors={['#5B46F6', '#8B5CF6']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.generateBtnGrad}
          >
            {loading ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <>
                <Icon name="qr-code-outline" size={20} color="#FFFFFF" style={{ marginRight: 6 }} />
                <Text style={styles.generateBtnText}>Generate QR Code</Text>
                <Icon name="arrow-forward" size={18} color="#FFFFFF" style={{ marginLeft: 6 }} />
              </>
            )}
          </LinearGradient>
        </TouchableOpacity>

        {/* Safety Info Banner Card */}
        <View style={styles.safetyCard}>
          <View style={styles.shieldBadge}>
            <Icon name="shield-checkmark" size={22} color="#A78BFA" />
          </View>
          <View style={styles.safetyTextCol}>
            <Text style={styles.safetyTitle}>Pairing keeps them safer</Text>
            <Text style={styles.safetySub}>A quick scan today. A safer tomorrow.</Text>
          </View>
          <Image
            source={require('../../assets/pair_banner_art.png')}
            style={styles.safetyBannerArt}
            resizeMode="contain"
          />
        </View>

        {/* Extra spacer for bottom floating tab bar */}
        <View style={{ height: 110 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#070A18',
  },
  scrollContent: {
    paddingHorizontal: 18,
  },

  /* Header Illustration */
  headerContainer: {
    width: SCREEN_WIDTH,
    marginHorizontal: -18,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Platform.OS === 'android' ? -(StatusBar.currentHeight || 24) : 0,
    marginBottom: 8,
  },
  headerImage: {
    width: SCREEN_WIDTH,
    height: Math.round(SCREEN_WIDTH * (355 / 472)),
  },

  /* Title & Subtitle */
  titleSection: {
    marginBottom: 18,
    marginTop: 2,
  },
  mainTitle: {
    fontFamily: Fonts.bold,
    fontSize: 28,
    color: '#FFFFFF',
    letterSpacing: -0.4,
  },
  highlightText: {
    color: '#9E8AFF',
    fontFamily: Fonts.bold,
  },
  mainSubtitle: {
    fontFamily: Fonts.regular,
    fontSize: 12.5,
    color: '#8E9BB5',
    lineHeight: 18.5,
    marginTop: 6,
  },

  /* Sections */
  sectionContainer: {
    marginBottom: 16,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 9,
  },
  sectionHeaderLabel: {
    fontFamily: Fonts.bold,
    fontSize: 11.5,
    color: '#6F82A4',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  sectionHeaderAction: {
    fontFamily: Fonts.semiBold,
    fontSize: 12.5,
    color: '#9E8AFF',
  },

  /* Existing Child Card */
  childCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16, 24, 52, 0.75)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(65, 85, 150, 0.35)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
  },
  childCardSelected: {
    borderColor: '#6366F1',
    backgroundColor: 'rgba(30, 42, 92, 0.85)',
  },
  childAvatarBadge: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: 'rgba(70, 55, 135, 0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    overflow: 'hidden',
  },
  childAvatarBadgeImg: {
    width: '100%',
    height: '100%',
    borderRadius: 14,
  },
  childAvatarInitial: {
    fontFamily: Fonts.bold,
    fontSize: 19,
    color: '#FFFFFF',
  },
  childInfoCol: {
    flex: 1,
    justifyContent: 'center',
  },
  childNameText: {
    fontFamily: Fonts.bold,
    fontSize: 16,
    color: '#FFFFFF',
    marginBottom: 0,
  },
  chevronButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(32, 44, 82, 0.8)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chevronButtonSelected: {
    backgroundColor: '#8B5CF6',
  },

  /* Name Input */
  nameInputCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(18, 26, 58, 0.75)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(65, 85, 150, 0.35)',
    paddingHorizontal: 13,
    height: 50,
    marginBottom: 14,
  },
  nameInputDisabled: {
    opacity: 0.5,
  },
  nameInputIcon: {
    marginRight: 10,
  },
  nameTextInput: {
    flex: 1,
    fontFamily: Fonts.regular,
    fontSize: 14,
    color: '#FFFFFF',
    height: '100%',
  },

  avatarHeading: {
    fontFamily: Fonts.bold,
    fontSize: 11,
    color: '#6F82A4',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 10,
    marginTop: 2,
  },

  /* Avatars Row */
  avatarsRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
  },
  avatarWrapper: {
    width: 56,
    height: 56,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(22, 30, 62, 0.7)',
    borderWidth: 2,
    borderColor: 'rgba(65, 85, 150, 0.3)',
    overflow: 'hidden',
  },
  avatarWrapperSelected: {
    borderColor: '#8B5CF6',
    backgroundColor: 'rgba(139, 92, 246, 0.2)',
    shadowColor: '#8B5CF6',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.8,
    shadowRadius: 6,
    elevation: 6,
  },
  avatarImg: {
    width: '100%',
    height: '100%',
  },
  uploadWrapper: {
    alignItems: 'center',
    width: 58,
  },
  uploadBox: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: 'rgba(22, 30, 62, 0.65)',
    borderWidth: 1.5,
    borderColor: 'rgba(100, 115, 215, 0.45)',
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    position: 'relative',
  },
  uploadBoxSelected: {
    borderStyle: 'solid',
    borderColor: '#8B5CF6',
    borderWidth: 2,
    backgroundColor: 'rgba(139, 92, 246, 0.2)',
    shadowColor: '#8B5CF6',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.8,
    shadowRadius: 6,
    elevation: 6,
  },
  uploadCameraBadge: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#6366F1',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#FFFFFF',
  },
  uploadBtnText: {
    fontFamily: Fonts.medium,
    fontSize: 9.5,
    color: '#8E9BB5',
    textAlign: 'center',
    marginTop: 4,
    lineHeight: 12,
  },
  uploadBtnTextSelected: {
    color: '#C4B5FD',
    fontFamily: Fonts.bold,
  },

  /* Generate Button */
  generateBtn: {
    width: '100%',
    marginBottom: 16,
    shadowColor: '#6366F1',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 6,
  },
  generateBtnGrad: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 52,
    borderRadius: 16,
  },
  generateBtnText: {
    fontFamily: Fonts.bold,
    fontSize: 15,
    color: '#FFFFFF',
  },

  /* Safety Banner Card */
  safetyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(14, 21, 48, 0.75)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(65, 85, 150, 0.35)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    overflow: 'hidden',
  },
  shieldBadge: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: 'rgba(40, 50, 110, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  safetyTextCol: {
    flex: 1,
    justifyContent: 'center',
  },
  safetyTitle: {
    fontFamily: Fonts.bold,
    fontSize: 13,
    color: '#FFFFFF',
  },
  safetySub: {
    fontFamily: Fonts.regular,
    fontSize: 10.5,
    color: '#8E9BB5',
    marginTop: 2,
  },
  safetyBannerArt: {
    width: 110,
    height: 50,
    marginLeft: 4,
  },

  /* Pairing Active Step */
  pairingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(21, 30, 64, 0.75)',
  },
  pairingTitle: {
    fontFamily: Fonts.bold,
    fontSize: 20,
    color: '#FFFFFF',
  },
  qrCard: {
    backgroundColor: 'rgba(14, 21, 48, 0.85)',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(65, 85, 150, 0.4)',
    padding: 20,
    alignItems: 'center',
  },
  qrContainer: {
    marginBottom: 16,
  },
  qrBorder: {
    borderWidth: 2,
    borderRadius: 18,
    padding: 10,
    backgroundColor: '#FFFFFF',
  },
  progressBarBg: {
    width: '100%',
    height: 5,
    backgroundColor: 'rgba(30, 42, 80, 0.6)',
    borderRadius: 3,
    marginBottom: 12,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  countdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 16,
  },
  countdownText: {
    fontFamily: Fonts.bold,
    fontSize: 18,
    color: '#8E9BB5',
    letterSpacing: 2,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    marginBottom: 16,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(65, 85, 150, 0.3)',
  },
  dividerText: {
    fontFamily: Fonts.regular,
    fontSize: 11,
    color: '#6F82A4',
    paddingHorizontal: 10,
  },
  otpRow: {
    flexDirection: 'row',
    gap: 7,
    marginBottom: 18,
  },
  otpDigit: {
    width: 40,
    height: 50,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(23, 31, 64, 0.8)',
    borderWidth: 1.5,
    borderColor: 'rgba(99, 102, 241, 0.5)',
  },
  otpDigitText: {
    fontFamily: Fonts.bold,
    fontSize: 22,
    color: '#A5B4FC',
  },
  pairingHint: {
    fontFamily: Fonts.regular,
    fontSize: 12,
    color: '#8E9BB5',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 16,
  },
  refreshBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: 8,
  },
  refreshText: {
    fontFamily: Fonts.medium,
    fontSize: 13,
    color: '#A78BFA',
  },

  /* Success Step */
  successContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 36,
  },
  successIcon: {
    width: 90,
    height: 90,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
    elevation: 8,
  },
  successTitle: {
    fontFamily: Fonts.bold,
    fontSize: 24,
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: 10,
  },
  successSub: {
    fontFamily: Fonts.regular,
    fontSize: 13.5,
    color: '#8E9BB5',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 30,
  },
  successBtn: {
    width: '100%',
  },
  successBtnGrad: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 48,
    borderRadius: 14,
  },
  successBtnText: {
    fontFamily: Fonts.bold,
    fontSize: 14.5,
    color: '#FFFFFF',
  },
});
