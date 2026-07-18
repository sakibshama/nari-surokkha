import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AuthStackParamList } from '../../navigation/AuthStack';
import { useAuthStore } from '../../store/authStore';
import api from '../../services/api';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, font, spacing, radius, shadows } from '../../theme';
import { Phone, Lock, ArrowRight } from 'lucide-react-native';
import FlagRoundel from '../../components/FlagRoundel';

const ROSE_GRADIENT = ['#fb7185', '#e11d48', '#be123c'] as const;

type Props = NativeStackScreenProps<AuthStackParamList, 'Login'>;

export default function LoginScreen({ navigation }: Props) {
  const [phone, setPhone] = useState('01700000000');
  const [password, setPassword] = useState('password123');
  const [loading, setLoading] = useState(false);
  const [phoneFocused, setPhoneFocused] = useState(false);
  const [passFocused, setPassFocused] = useState(false);
  const login = useAuthStore((state) => state.login);

  const handleLogin = async () => {
    if (!phone || !password) { Alert.alert('Error', 'Please enter both phone and password'); return; }
    let formattedPhone = phone.trim();
    if (formattedPhone.startsWith('01')) formattedPhone = '+88' + formattedPhone;
    setLoading(true);
    try {
      const response = await api.post('/auth/login', { phone: formattedPhone, password });
      const { user, tokens } = response.data.data;
      await login(user, tokens.accessToken);
    } catch (error: any) {
      Alert.alert('Login Failed', error.response?.data?.error?.message || 'Something went wrong');
    } finally { setLoading(false); }
  };

  return (
    <LinearGradient colors={['#0b0916', '#0e1224', '#0c1a2e']} style={styles.root}>
      {/* Ambient glows */}
      <View pointerEvents="none" style={styles.glowRose} />
      <View pointerEvents="none" style={styles.glowGreen} />

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

          {/* Government identity */}
          <View style={styles.govStrip}>
            <FlagRoundel size={22} />
            <View style={{ flex: 1 }}>
              <Text style={styles.govStripBn}>গণপ্রজাতন্ত্রী বাংলাদেশ সরকার</Text>
              <Text style={styles.govStripEn}>National Women Safety Service</Text>
            </View>
          </View>

          {/* Hero Brand Block */}
          <View style={styles.brand}>
            <View style={styles.logoRing}>
              <View style={styles.logoInner}>
                <FlagRoundel size={54} />
              </View>
            </View>
            <Text style={styles.appNameBn}>নারী সুরক্ষা</Text>
            <Text style={styles.appName}>Nari Surokkha</Text>
            <Text style={styles.tagline}>Your Personal Safety Guardian</Text>
          </View>

          {/* Card */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Welcome Back</Text>
            <Text style={styles.cardSub}>Sign in to your account</Text>

            {/* Phone Field */}
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>PHONE NUMBER</Text>
              <View style={[styles.inputRow, phoneFocused && styles.inputRowFocused]}>
                <Phone color={phoneFocused ? colors.primary : colors.textMuted} size={18} />
                <TextInput
                  style={styles.input}
                  placeholder="01700000000"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="phone-pad"
                  value={phone}
                  onChangeText={setPhone}
                  autoCapitalize="none"
                  onFocus={() => setPhoneFocused(true)}
                  onBlur={() => setPhoneFocused(false)}
                />
              </View>
            </View>

            {/* Password Field */}
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>PASSWORD</Text>
              <View style={[styles.inputRow, passFocused && styles.inputRowFocused]}>
                <Lock color={passFocused ? colors.primary : colors.textMuted} size={18} />
                <TextInput
                  style={styles.input}
                  placeholder="Enter password"
                  placeholderTextColor={colors.textMuted}
                  secureTextEntry
                  value={password}
                  onChangeText={setPassword}
                  onFocus={() => setPassFocused(true)}
                  onBlur={() => setPassFocused(false)}
                />
              </View>
            </View>

            {/* Login Button */}
            <TouchableOpacity onPress={handleLogin} disabled={loading} activeOpacity={0.85} style={styles.btnWrapper}>
              <LinearGradient colors={ROSE_GRADIENT} style={styles.btn} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
                {loading
                  ? <ActivityIndicator color="#fff" />
                  : <>
                      <Text style={styles.btnText}>Log In</Text>
                      <ArrowRight color="#fff" size={20} />
                    </>
                }
              </LinearGradient>
            </TouchableOpacity>

            {/* Register Link */}
            <TouchableOpacity style={styles.link} onPress={() => navigation.navigate('Register')}>
              <Text style={styles.linkText}>Don't have an account? </Text>
              <Text style={styles.linkAccent}>Register →</Text>
            </TouchableOpacity>
          </View>

          {/* Footer note */}
          <Text style={styles.footer}>Protected by end-to-end encryption 🔐</Text>
          <View style={styles.govFooter}>
            <FlagRoundel size={14} />
            <Text style={styles.govFooterText}>জাতীয় নারী নিরাপত্তা সেবা · Govt. of Bangladesh</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: spacing.lg, paddingBottom: 120, paddingTop: 70 },
  glowRose: {
    position: 'absolute', top: -80, right: -100,
    width: 280, height: 280, borderRadius: 140,
    backgroundColor: 'rgba(244,114,182,0.09)',
  },
  glowGreen: {
    position: 'absolute', bottom: -100, left: -110,
    width: 300, height: 300, borderRadius: 150,
    backgroundColor: 'rgba(0,168,120,0.08)',
  },
  govStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: 'rgba(0,106,78,0.14)',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'rgba(0,168,120,0.25)',
    marginBottom: spacing.xl,
  },
  govStripBn: { color: 'rgba(255,255,255,0.92)', fontSize: 12, fontWeight: '700' },
  govStripEn: { color: 'rgba(255,255,255,0.55)', fontSize: 10, fontWeight: '600', letterSpacing: 0.6, textTransform: 'uppercase' },
  brand: { alignItems: 'center', marginBottom: spacing.xl },
  logoRing: {
    width: 92, height: 92, borderRadius: 30,
    borderWidth: 2, borderColor: 'rgba(244,114,182,0.35)',
    padding: 5, marginBottom: spacing.md,
    shadowColor: '#f472b6', shadowOpacity: 0.45, shadowRadius: 22,
    shadowOffset: { width: 0, height: 6 }, elevation: 10,
  },
  logoInner: {
    flex: 1, borderRadius: 24,
    backgroundColor: 'rgba(0,106,78,0.18)',
    alignItems: 'center', justifyContent: 'center',
  },
  appNameBn: { color: '#fff', fontSize: 32, fontWeight: '800', marginBottom: 2 },
  appName: { ...font.sm, color: 'rgba(255,255,255,0.7)', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 6 },
  tagline: { ...font.sm, color: colors.textMuted, letterSpacing: 0.3 },
  card: {
    backgroundColor: colors.bgCard,
    borderRadius: radius.xl,
    padding: spacing.lg + 4,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    ...shadows.card,
  },
  cardTitle: { ...font.h2, marginBottom: 4 },
  cardSub: { ...font.sm, color: colors.textMuted, marginBottom: spacing.lg + 4 },
  fieldGroup: { marginBottom: spacing.md },
  fieldLabel: { ...font.label, marginBottom: spacing.sm, textTransform: 'uppercase' },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.bgInput,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
  },
  inputRowFocused: { borderColor: '#f472b6', backgroundColor: 'rgba(244,114,182,0.06)' },
  input: { flex: 1, ...font.body, color: colors.text, minHeight: 44, paddingVertical: 4 },
  btnWrapper: {
    marginTop: spacing.lg, borderRadius: radius.lg,
    shadowColor: '#e11d48', shadowOpacity: 0.5, shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 }, elevation: 10,
  },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: spacing.md, borderRadius: radius.lg },
  btnText: { ...font.h3, color: '#fff', letterSpacing: 0.5 },
  link: { flexDirection: 'row', justifyContent: 'center', marginTop: spacing.lg },
  linkText: { ...font.sm, color: colors.textMuted },
  linkAccent: { ...font.sm, color: '#f472b6', fontWeight: '700' },
  footer: { ...font.xs, color: colors.textMuted, textAlign: 'center', marginTop: spacing.xl },
  govFooter: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing.sm, marginTop: spacing.md, opacity: 0.6,
  },
  govFooterText: { color: colors.textMuted, fontSize: 10.5, fontWeight: '600', letterSpacing: 0.3 },
});
