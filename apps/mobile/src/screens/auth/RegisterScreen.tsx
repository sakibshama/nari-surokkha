import React, { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ArrowRight, Eye, EyeOff, KeyRound, Lock, Phone, ShieldCheck, User } from 'lucide-react-native';

import { AuthStackParamList } from '../../navigation/AuthStack';
import { useAuthStore } from '../../store/authStore';
import api from '../../services/api';
import AuthLayout from '../../components/AuthLayout';
import { Button, Field, Txt } from '../../components/ui';
import { useTheme } from '../../theme';
import { useT } from '../../i18n';
import { spacing } from '../../theme/tokens';

type Props = NativeStackScreenProps<AuthStackParamList, 'Register'>;

const RESEND_SECONDS = 60;

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

  const [step, setStep] = useState<'details' | 'code'>('details');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const id = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [resendIn]);

  const formattedPhone = (() => {
    const p = phone.trim();
    return p.startsWith('01') ? `+88${p}` : p;
  })();

  const apiMessage = (err: unknown) =>
    (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ||
    t('Something went wrong. Please try again.');

  /** Step 1: check the form, then text a 6-digit code to the phone. */
  const requestCode = async () => {
    if (!fullName.trim() || !phone.trim() || !password) {
      setError(t('Please fill all required fields.'));
      return;
    }
    if (password !== confirmPassword) {
      setError(t('Passwords do not match.'));
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const res = await api.post('/auth/otp/request', { phone: formattedPhone });
      const data = res.data?.data as { expiresInSec?: number; devCode?: string } | undefined;
      // Only a development server with the mock SMS provider returns the code.
      setDevCode(__DEV__ && data?.devCode ? data.devCode : null);
      setCode('');
      setResendIn(RESEND_SECONDS);
      setStep('code');
    } catch (err) {
      setError(apiMessage(err));
    } finally {
      setLoading(false);
    }
  };

  /** Step 2: verify the code, then create the account with the proof. */
  const handleRegister = async () => {
    if (!/^\d{6}$/.test(code)) {
      setError(t('Enter the 6-digit code.'));
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const verified = await api.post('/auth/otp/verify', { phone: formattedPhone, code });
      const otpToken: string | undefined = verified.data?.data?.otpToken;
      const response = await api.post('/auth/register', {
        fullName: fullName.trim(),
        phone: formattedPhone,
        password,
        otpToken,
      });
      const { user, tokens } = response.data.data;
      await login(user, tokens.accessToken, tokens.refreshToken);
    } catch (err) {
      setError(apiMessage(err));
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
      {step === 'code' ? (
        <>
          <Txt variant="sm" tone="muted" style={{ marginBottom: spacing.md }}>
            {t('We sent a 6-digit code by SMS to {phone}.', { phone: formattedPhone })}
          </Txt>
          {devCode && (
            <Txt variant="xs" tone="accent" style={{ marginBottom: spacing.sm }}>
              {t('Development code: {code}', { code: devCode })}
            </Txt>
          )}
          <Field
            label={t('Verification code')}
            placeholder="123456"
            keyboardType="number-pad"
            autoComplete="sms-otp"
            textContentType="oneTimeCode"
            maxLength={6}
            value={code}
            onChangeText={(v) => { setCode(v.replace(/\D/g, '')); clearError(); }}
            icon={(c) => <KeyRound size={18} color={c} />}
            error={error ?? undefined}
          />
          <Button
            label={t('Verify and create account')}
            size="lg"
            loading={loading}
            onPress={handleRegister}
            iconRight={!loading ? <ArrowRight size={19} color={colors.onAccent} /> : undefined}
            style={{ marginTop: spacing.sm }}
          />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.md }}>
            <Pressable onPress={() => { setStep('details'); setError(null); }} hitSlop={8}>
              <Txt variant="smStrong" tone="accent">{t('Change number')}</Txt>
            </Pressable>
            <Pressable onPress={resendIn > 0 || loading ? undefined : requestCode} hitSlop={8} disabled={resendIn > 0 || loading}>
              <Txt variant="smStrong" tone={resendIn > 0 ? 'muted' : 'accent'}>
                {resendIn > 0 ? t('Resend code in {n}s', { n: resendIn }) : t('Resend code')}
              </Txt>
            </Pressable>
          </View>
        </>
      ) : (
        <>
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
            label={t('Send verification code')}
            size="lg"
            loading={loading}
            onPress={requestCode}
            iconRight={!loading ? <ArrowRight size={19} color={colors.onAccent} /> : undefined}
            style={{ marginTop: spacing.sm }}
          />
        </>
      )}

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
