import React, { useState } from 'react';
import { Pressable } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ArrowRight, Eye, EyeOff, Lock, Phone } from 'lucide-react-native';

import { AuthStackParamList } from '../../navigation/AuthStack';
import { useAuthStore } from '../../store/authStore';
import api from '../../services/api';
import AuthLayout from '../../components/AuthLayout';
import { Button, Field, FadeIn, Txt } from '../../components/ui';
import { useTheme } from '../../theme';
import { useT } from '../../i18n';
import { spacing } from '../../theme/tokens';

type Props = NativeStackScreenProps<AuthStackParamList, 'Login'>;

export default function LoginScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const t = useT();

  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const login = useAuthStore((state) => state.login);

  const handleLogin = async () => {
    if (!phone.trim() || !password) {
      setError(t('Enter your phone number and password.'));
      return;
    }
    setError(null);

    let formattedPhone = phone.trim();
    if (formattedPhone.startsWith('01')) formattedPhone = '+88' + formattedPhone;

    setLoading(true);
    try {
      const response = await api.post('/auth/login', { phone: formattedPhone, password });
      const { user, tokens } = response.data.data;
      await login(user, tokens.accessToken, tokens.refreshToken);
    } catch (err: any) {
      const message = err.response?.data?.error?.message;
      // Inline error keeps the form and the failure in one place.
      setError(message || t('We could not sign you in. Check your details and try again.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      title={t('Welcome back')}
      subtitle={t('Sign in to reach your trusted contacts and nearby responders instantly.')}
    >
      <Field
        label={t('Phone number')}
        placeholder="01700000000"
        keyboardType="phone-pad"
        autoCapitalize="none"
        autoComplete="tel"
        value={phone}
        onChangeText={(v) => {
          setPhone(v);
          if (error) setError(null);
        }}
        icon={(c) => <Phone size={18} color={c} />}
        hint={t('Numbers starting 01… get +88 added for you.')}
      />

      <Field
        label={t('Password')}
        placeholder={t('Enter your password')}
        secureTextEntry={!reveal}
        autoComplete="current-password"
        value={password}
        onChangeText={(v) => {
          setPassword(v);
          if (error) setError(null);
        }}
        icon={(c) => <Lock size={18} color={c} />}
        error={error ?? undefined}
        trailing={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={reveal ? t('Hide password') : t('Show password')}
            onPress={() => setReveal((v) => !v)}
            hitSlop={10}
          >
            {reveal ? <EyeOff size={18} color={colors.textMuted} /> : <Eye size={18} color={colors.textMuted} />}
          </Pressable>
        }
      />

      <Button
        label={t('Log in')}
        size="lg"
        loading={loading}
        onPress={handleLogin}
        iconRight={!loading ? <ArrowRight size={19} color={colors.onAccent} /> : undefined}
        style={{ marginTop: spacing.sm }}
      />

      <FadeIn delay={420}>
        <Pressable
          onPress={() => navigation.navigate('Register')}
          style={{ flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', marginTop: spacing.lg, paddingVertical: spacing.xs }}
          hitSlop={8}
        >
          <Txt variant="sm" tone="muted">{t('New here?')} </Txt>
          <Txt variant="smStrong" tone="accent">{t('Create an account →')}</Txt>
        </Pressable>
      </FadeIn>
    </AuthLayout>
  );
}
