import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, Modal, TouchableOpacity, TextInput,
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons as Icon } from '@expo/vector-icons';
import { Colors, Fonts, Spacing, Radius } from '../theme/tokens';

export default function CompleteProfileModal({
  visible,
  initialName = '',
  initialPhone = '',
  onSave,
  onSkip,
  loading = false,
}) {
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState(initialPhone);
  const [error, setError] = useState('');

  useEffect(() => {
    setName(initialName || '');
    setPhone(initialPhone || '');
    setError('');
  }, [visible, initialName, initialPhone]);

  const handleSavePress = () => {
    setError('');
    const cleanPhone = (phone || '').trim();
    if (!cleanPhone) {
      setError('Please provide a phone number to receive safety alerts.');
      return;
    }
    if (cleanPhone.length < 7) {
      setError('Please enter a valid phone number (at least 7 digits).');
      return;
    }
    if (onSave) {
      onSave({
        name: (name || '').trim() || initialName,
        phone: cleanPhone,
      });
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onSkip}
    >
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.card}>
          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.scrollContent}
          >
            {/* Header Icon */}
            <View style={styles.iconContainer}>
              <LinearGradient
                colors={['#615BFC', '#8B5CF6']}
                style={styles.iconGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
              >
                <Icon name="shield-checkmark" size={30} color="#FFFFFF" />
              </LinearGradient>
            </View>

            <Text style={styles.title}>Complete Your Profile</Text>
            <Text style={styles.subtitle}>
              CareTrack sends critical tamper alerts, geofence breaches, and low-battery warnings to your phone number.
            </Text>

            {/* Error banner */}
            {error ? (
              <View style={styles.errorBox}>
                <Icon name="alert-circle-outline" size={16} color={Colors.status.danger} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            {/* Phone Input */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>
                Phone Number <Text style={styles.requiredStar}>*</Text>
              </Text>
              <View style={styles.inputWrapper}>
                <Icon name="call-outline" size={18} color="#8B9CB8" style={styles.inputLeadIcon} />
                <TextInput
                  style={styles.textInput}
                  value={phone}
                  onChangeText={(val) => {
                    setPhone(val);
                    if (error) setError('');
                  }}
                  placeholder="+1 (555) 000-0000"
                  placeholderTextColor="#5A6B88"
                  keyboardType="phone-pad"
                  autoFocus={true}
                />
                {phone ? (
                  <TouchableOpacity onPress={() => setPhone('')} style={styles.clearBtn}>
                    <Icon name="close-circle" size={16} color="#8B9CB8" />
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>

            {/* Name Input */}
            <View style={[styles.inputGroup, { marginTop: 14 }]}>
              <Text style={styles.inputLabel}>Parent / Guardian Name</Text>
              <View style={styles.inputWrapper}>
                <Icon name="person-outline" size={18} color="#8B9CB8" style={styles.inputLeadIcon} />
                <TextInput
                  style={styles.textInput}
                  value={name}
                  onChangeText={setName}
                  placeholder="Your Full Name"
                  placeholderTextColor="#5A6B88"
                  autoCapitalize="words"
                />
              </View>
            </View>

            {/* Action Buttons */}
            <TouchableOpacity
              style={styles.saveBtn}
              onPress={handleSavePress}
              disabled={loading}
              activeOpacity={0.85}
            >
              <LinearGradient
                colors={['#615BFC', '#715BFB', '#8657F9']}
                style={styles.saveBtnGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
              >
                {loading ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <>
                    <Text style={styles.saveBtnText}>Save & Continue</Text>
                    <Icon name="checkmark" size={18} color="#FFFFFF" />
                  </>
                )}
              </LinearGradient>
            </TouchableOpacity>

            {onSkip ? (
              <TouchableOpacity
                style={styles.skipBtn}
                onPress={onSkip}
                disabled={loading}
                activeOpacity={0.7}
              >
                <Text style={styles.skipBtnText}>I'll add this later</Text>
              </TouchableOpacity>
            ) : null}
          </ScrollView>
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
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 15,
  },
  scrollContent: {
    padding: Spacing.xl,
    alignItems: 'center',
  },
  iconContainer: {
    marginBottom: Spacing.md,
  },
  iconGradient: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#615BFC',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 6,
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
  requiredStar: {
    color: '#F43F5E',
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
  clearBtn: {
    padding: 4,
  },
  saveBtn: {
    width: '100%',
    height: 48,
    borderRadius: Radius.md,
    overflow: 'hidden',
    marginTop: Spacing.xl,
  },
  saveBtnGradient: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  saveBtnText: {
    fontFamily: Fonts.semiBold,
    fontSize: 15,
    color: '#FFFFFF',
  },
  skipBtn: {
    marginTop: Spacing.md,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  skipBtnText: {
    fontFamily: Fonts.medium,
    fontSize: 13,
    color: '#94A3B8',
  },
});
