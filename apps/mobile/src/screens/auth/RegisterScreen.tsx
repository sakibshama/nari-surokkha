import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, Image
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AuthStackParamList } from '../../navigation/AuthStack';
import { useAuthStore } from '../../store/authStore';
import api from '../../services/api';
import { LinearGradient } from 'expo-linear-gradient';
import { Theme, useTheme, useThemedStyles } from '../../theme';
import { radius, spacing, type } from '../../theme/tokens';
import { User, Phone, Lock, ArrowRight } from 'lucide-react-native';
import FlagRoundel from '../../components/FlagRoundel';


type Props = NativeStackScreenProps<AuthStackParamList, 'Register'>;

/** Local field. Reads the theme itself, so it works at module scope. */
function Field({ label, icon: Icon, value, onChange, placeholder, secure = false, keyboard = 'default' as any, id, focused, setFocused }: any) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  return (
  <View style={styles.fieldGroup}>
    <Text style={styles.fieldLabel}>{label}</Text>
    <View style={[styles.inputRow, focused === id && styles.inputRowFocused]}>
      <Icon color={focused === id ? colors.accent : colors.textMuted} size={18} />
      <TextInput
        style={styles.input}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        value={value}
        onChangeText={onChange}
        secureTextEntry={secure}
        keyboardType={keyboard}
        autoCapitalize={id === 'phone' ? 'none' : 'words'}
        onFocus={() => setFocused(id)}
        onBlur={() => setFocused('')}
      />
    </View>
  </View>
  );
}

export default function RegisterScreen({ navigation }: Props) {
  const styles = useThemedStyles(makeStyles);
  const { colors, gradients, shadows } = useTheme();
  void gradients; void shadows;
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState('');
  const login = useAuthStore((state) => state.login);

  const handleRegister = async () => {
    if (!fullName || !phone || !password) { Alert.alert('Error', 'Please fill all required fields'); return; }
    if (password !== confirmPassword) { Alert.alert('Error', 'Passwords do not match'); return; }
    let formattedPhone = phone.trim();
    if (formattedPhone.startsWith('01')) formattedPhone = '+88' + formattedPhone;
    setLoading(true);
    try {
      const response = await api.post('/auth/register', { fullName, phone: formattedPhone, password });
      const { user, tokens } = response.data.data;
      await login(user, tokens.accessToken, tokens.refreshToken);
    } catch (error: any) {
      Alert.alert('Registration Failed', error.response?.data?.error?.message || 'Something went wrong');
    } finally { setLoading(false); }
  };

  return (
    <LinearGradient colors={gradients.hero} style={styles.root}>
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

          {/* Header */}
          <View style={styles.brand}>
            <Image source={require('../../../assets/icon.png')} style={styles.logo} resizeMode="contain" />
            <Text style={styles.appName}>Create your account</Text>
            <Text style={styles.tagline}>Join Nari Surokkha today</Text>
          </View>

          {/* Card */}
          <View style={styles.card}>
            <Field label="FULL NAME" icon={User} value={fullName} onChange={setFullName} placeholder="Your full name" id="name" focused={focused} setFocused={setFocused} />
            <Field label="PHONE NUMBER" icon={Phone} value={phone} onChange={setPhone} placeholder="01700000000" keyboard="phone-pad" id="phone" focused={focused} setFocused={setFocused} />
            <Field label="PASSWORD" icon={Lock} value={password} onChange={setPassword} placeholder="Create a password" secure id="pass" focused={focused} setFocused={setFocused} />
            <Field label="CONFIRM PASSWORD" icon={Lock} value={confirmPassword} onChange={setConfirmPassword} placeholder="Repeat your password" secure id="confirm" focused={focused} setFocused={setFocused} />

            <TouchableOpacity onPress={handleRegister} disabled={loading} activeOpacity={0.85} style={styles.btnWrapper}>
              <LinearGradient colors={gradients.accent} style={styles.btn} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
                {loading
                  ? <ActivityIndicator color={colors.onFill} />
                  : <>
                      <Text style={styles.btnText}>Create Account</Text>
                      <ArrowRight color={colors.onFill} size={20} />
                    </>
                }
              </LinearGradient>
            </TouchableOpacity>

            <TouchableOpacity style={styles.link} onPress={() => navigation.navigate('Login')}>
              <Text style={styles.linkText}>Already have an account? </Text>
              <Text style={styles.linkAccent}>Log In →</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.footer}>Your data is private and encrypted 🔐</Text>
          <View style={styles.govFooter}>
            <FlagRoundel size={14} />
            <Text style={styles.govFooterText}>জাতীয় নারী নিরাপত্তা সেবা · Govt. of Bangladesh</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const makeStyles = ({ colors, shadows, gradients }: Theme) => {
  const font = {
    hero: { ...type.hero, color: colors.text },
    h1: { ...type.h1, color: colors.text },
    h2: { ...type.h2, color: colors.text },
    h3: { ...type.h3, color: colors.text },
    body: { ...type.body, color: colors.text },
    sm: { ...type.sm, color: colors.textSub },
    xs: { ...type.xs, color: colors.textMuted },
    label: { ...type.label, color: colors.textSub },
    regular: 'System' as const, medium: 'System' as const,
    semiBold: 'System' as const, bold: 'System' as const,
  };
  void gradients;
  return StyleSheet.create({
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
  govStripBn: { color: colors.textSub, fontSize: 12, fontWeight: '700' },
  govStripEn: { color: colors.textMuted, fontSize: 10, fontWeight: '600', letterSpacing: 0.6, textTransform: 'uppercase' },
  brand: { alignItems: 'center', marginBottom: spacing.xl },
  logo: {
    width: 116, height: 116, borderRadius: 30, marginBottom: spacing.md,
    shadowColor: colors.accent, shadowOpacity: 0.4, shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 }, elevation: 12,
  },
  appName: { ...font.sm, color: colors.textSub, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 6 },
  tagline: { ...font.sm, color: colors.textMuted, letterSpacing: 0.3 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.lg + 4,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.card,
  },
  fieldGroup: { marginBottom: spacing.md },
  fieldLabel: { ...font.label, marginBottom: spacing.sm, textTransform: 'uppercase' },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.inputBg,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
  },
  inputRowFocused: { borderColor: colors.accent, backgroundColor: 'rgba(244,114,182,0.06)' },
  input: { flex: 1, ...font.body, color: colors.text, minHeight: 44, paddingVertical: 4 },
  btnWrapper: {
    marginTop: spacing.lg, borderRadius: radius.lg,
    shadowColor: colors.danger, shadowOpacity: 0.5, shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 }, elevation: 10,
  },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: spacing.md, borderRadius: radius.lg },
  btnText: { ...font.h3, color: colors.onFill, letterSpacing: 0.5 },
  link: { flexDirection: 'row', justifyContent: 'center', marginTop: spacing.lg },
  linkText: { ...font.sm, color: colors.textMuted },
  linkAccent: { ...font.sm, color: colors.accent, fontWeight: '700' },
  footer: { ...font.xs, color: colors.textMuted, textAlign: 'center', marginTop: spacing.xl },
  govFooter: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing.sm, marginTop: spacing.md, opacity: 0.6,
  },
  govFooterText: { color: colors.textMuted, fontSize: 10.5, fontWeight: '600', letterSpacing: 0.3 },
});
};
