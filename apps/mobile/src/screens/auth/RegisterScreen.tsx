import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ArrowRight, Eye, EyeOff, Lock, Phone, ShieldCheck, User } from 'lucide-react-native';

import { AuthStackParamList } from '../../navigation/AuthStack';
import { useAuthStore } from '../../store/authStore';
import api from '../../services/api';
import AuthLayout from '../../components/AuthLayout';
import { Button, Field, Txt } from '../../components/ui';
import { useTheme } from '../../theme';
import { useT } from '../../i18n';
import { spacing } from '../../theme/tokens';

type Props = NativeStackScreenProps<AuthStackParamList, 'Register'>;

export default function RegisterScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const t = useT();

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const login = useAuthStore((state) => state.login);

  const handleRegister = async () => {
    if (!fullName.trim() || !phone.trim() || !password) {
      setError(t('Please fill all required fields.'));
      return;
    }
    if (password !== confirmPassword) {
      setError(t('Passwords do not match.'));
      return;
    }
    setError(null);
    let formattedPhone = phone.trim();
    if (formattedPhone.startsWith('01')) formattedPhone = '+88' + formattedPhone;
    setLoading(true);
    try {
      const response = await api.post('/auth/register', {
        fullName: fullName.trim(),
        phone: formattedPhone,
        password,
      });
      const { user, tokens } = response.data.data;
      await login(user, tokens.accessToken, tokens.refreshToken);
    } catch (err: any) {
      setError(err.response?.data?.error?.message || t('Something went wrong. Please try again.'));
    } finally {
      setLoading(false);
    }
  };

  const clearError = () => {
    if (error) setError(null);
  };

  const revealToggle = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={reveal ? t('Hide password') : t('Show password')}
      onPress={() => setReveal((v) => !v)}
      hitSlop={10}
    >
      {reveal ? <EyeOff size={18} color={colors.textMuted} /> : <Eye size={18} color={colors.textMuted} />}
    </Pressable>
  );

  return (
    <AuthLayout
      title={t('Create your account')}
      subtitle={t('Join Nari Surokkha today — it takes a minute.')}
      footer={
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: spacing.lg }}>
          <ShieldCheck size={14} color={colors.accentText} />
          <Txt variant="xs" tone="muted">{t('Your data is private and encrypted')}</Txt>
        </View>
      }
    >
      <Field
        label={t('Full name')}
        placeholder={t('Your full name')}
        autoCapitalize="words"
        autoComplete="name"
        value={fullName}
        onChangeText={(v) => { setFullName(v); clearError(); }}
        icon={(c) => <User size={18} color={c} />}
      />
      <Field
        label={t('Phone number')}
        placeholder="01700000000"
        keyboardType="phone-pad"
        autoCapitalize="none"
        autoComplete="tel"
        value={phone}
        onChangeText={(v) => { setPhone(v); clearError(); }}
        icon={(c) => <Phone size={18} color={c} />}
      />
      <Field
        label={t('Password')}
        placeholder={t('Create a password')}
        secureTextEntry={!reveal}
        autoComplete="new-password"
        value={password}
        onChangeText={(v) => { setPassword(v); clearError(); }}
        icon={(c) => <Lock size={18} color={c} />}
        trailing={revealToggle}
      />
      <Field
        label={t('Confirm password')}
        placeholder={t('Repeat your password')}
        secureTextEntry={!reveal}
        autoComplete="new-password"
        value={confirmPassword}
        onChangeText={(v) => { setConfirmPassword(v); clearError(); }}
        icon={(c) => <Lock size={18} color={c} />}
        error={error ?? undefined}
      />

      <Button
        label={t('Create account')}
        size="lg"
        loading={loading}
        onPress={handleRegister}
        iconRight={!loading ? <ArrowRight size={19} color={colors.onAccent} /> : undefined}
        style={{ marginTop: spacing.sm }}
      />

      <Pressable
        onPress={() => navigation.navigate('Login')}
        style={{ flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', marginTop: spacing.lg, paddingVertical: spacing.xs }}
        hitSlop={8}
      >
        <Txt variant="sm" tone="muted">{t('Already have an account?')} </Txt>
        <Txt variant="smStrong" tone="accent">{t('Log in →')}</Txt>
      </Pressable>
    </AuthLayout>
  );
}
