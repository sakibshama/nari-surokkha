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
import { colors, font, spacing, radius, shadows, gradients } from '../../theme';
import { Phone, Lock, ArrowRight, ShieldCheck } from 'lucide-react-native';

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
    <LinearGradient colors={['#060d1f', '#0a1428', '#0f1e3d']} style={styles.root}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

          {/* Hero Brand Block */}
          <View style={styles.brand}>
            <View style={styles.logoRing}>
              <LinearGradient colors={gradients.primary} style={styles.logoGradient}>
                <ShieldCheck color="#fff" size={36} />
              </LinearGradient>
            </View>
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
              <LinearGradient colors={gradients.primary} style={styles.btn} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
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
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: spacing.lg, paddingBottom: 150, paddingTop: 100 },
  brand: { alignItems: 'center', marginBottom: spacing.xl },
  logoRing: {
    width: 84, height: 84, borderRadius: 42,
    borderWidth: 2, borderColor: 'rgba(244,63,94,0.3)',
    padding: 3, marginBottom: spacing.md,
    ...shadows.primary,
  },
  logoGradient: { flex: 1, borderRadius: 40, alignItems: 'center', justifyContent: 'center' },
  appName: { ...font.hero, color: '#fff', marginBottom: 6 },
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
  inputRowFocused: { borderColor: colors.primary, backgroundColor: 'rgba(239,68,68,0.06)' },
  input: { flex: 1, ...font.body, color: colors.text, minHeight: 44, paddingVertical: 4 },
  btnWrapper: { marginTop: spacing.lg, borderRadius: radius.lg, ...shadows.primary },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: spacing.md, borderRadius: radius.lg },
  btnText: { ...font.h3, color: '#fff', letterSpacing: 0.5 },
  link: { flexDirection: 'row', justifyContent: 'center', marginTop: spacing.lg },
  linkText: { ...font.sm, color: colors.textMuted },
  linkAccent: { ...font.sm, color: colors.primary, fontWeight: '700' },
  footer: { ...font.xs, color: colors.textMuted, textAlign: 'center', marginTop: spacing.xl },
});
