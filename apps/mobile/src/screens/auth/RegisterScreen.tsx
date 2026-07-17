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
import { User, Phone, Lock, ArrowRight, ShieldCheck } from 'lucide-react-native';

type Props = NativeStackScreenProps<AuthStackParamList, 'Register'>;

const Field = ({ label, icon: Icon, value, onChange, placeholder, secure = false, keyboard = 'default' as any, id, focused, setFocused }: any) => (
  <View style={styles.fieldGroup}>
    <Text style={styles.fieldLabel}>{label}</Text>
    <View style={[styles.inputRow, focused === id && styles.inputRowFocused]}>
      <Icon color={focused === id ? colors.primary : colors.textMuted} size={18} />
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

export default function RegisterScreen({ navigation }: Props) {
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
      await login(user, tokens.accessToken);
    } catch (error: any) {
      Alert.alert('Registration Failed', error.response?.data?.error?.message || 'Something went wrong');
    } finally { setLoading(false); }
  };

  return (
    <LinearGradient colors={['#060d1f', '#0a1428', '#0f1e3d']} style={styles.root}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

          {/* Header */}
          <View style={styles.brand}>
            <View style={styles.logoRing}>
              <LinearGradient colors={gradients.primary} style={styles.logoGradient}>
                <ShieldCheck color="#fff" size={36} />
              </LinearGradient>
            </View>
            <Text style={styles.appName}>Create Account</Text>
            <Text style={styles.tagline}>Join Nari Surokkha today</Text>
          </View>

          {/* Card */}
          <View style={styles.card}>
            <Field label="FULL NAME" icon={User} value={fullName} onChange={setFullName} placeholder="Your full name" id="name" focused={focused} setFocused={setFocused} />
            <Field label="PHONE NUMBER" icon={Phone} value={phone} onChange={setPhone} placeholder="01700000000" keyboard="phone-pad" id="phone" focused={focused} setFocused={setFocused} />
            <Field label="PASSWORD" icon={Lock} value={password} onChange={setPassword} placeholder="Create a password" secure id="pass" focused={focused} setFocused={setFocused} />
            <Field label="CONFIRM PASSWORD" icon={Lock} value={confirmPassword} onChange={setConfirmPassword} placeholder="Repeat your password" secure id="confirm" focused={focused} setFocused={setFocused} />

            <TouchableOpacity onPress={handleRegister} disabled={loading} activeOpacity={0.85} style={styles.btnWrapper}>
              <LinearGradient colors={gradients.primary} style={styles.btn} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
                {loading
                  ? <ActivityIndicator color="#fff" />
                  : <>
                      <Text style={styles.btnText}>Create Account</Text>
                      <ArrowRight color="#fff" size={20} />
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
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: spacing.lg, paddingBottom: 150 },
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
