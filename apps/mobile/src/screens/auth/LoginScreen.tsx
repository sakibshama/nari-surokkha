import React, { useState } from 'react';
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  View,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
import { ArrowRight, Eye, EyeOff, Lock, Phone } from 'lucide-react-native';

import { AuthStackParamList } from '../../navigation/AuthStack';
import { useAuthStore } from '../../store/authStore';
import api from '../../services/api';
import FlagRoundel from '../../components/FlagRoundel';
import { Button, Card, Field, Txt } from '../../components/ui';
import { useTheme } from '../../theme';
import { radius, spacing } from '../../theme/tokens';

type Props = NativeStackScreenProps<AuthStackParamList, 'Login'>;

export default function LoginScreen({ navigation }: Props) {
  const { colors, gradients, shadows } = useTheme();

  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const login = useAuthStore((state) => state.login);

  const handleLogin = async () => {
    if (!phone.trim() || !password) {
      setError('Enter your phone number and password.');
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
      // An inline error keeps the form and the failure in one place; a modal
      // makes you dismiss it before you can see what you typed.
      setError(message || 'We could not sign you in. Check your details and try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <LinearGradient colors={gradients.hero} style={{ flex: 1 }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: 'center',
            padding: spacing.lg,
            paddingTop: spacing.xxl,
            paddingBottom: spacing.xxl,
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Government identity */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing.sm + 2,
              paddingVertical: spacing.sm,
              paddingHorizontal: spacing.md,
              backgroundColor: colors.govGreenSoft,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: colors.border,
              marginBottom: spacing.xl,
            }}
          >
            <FlagRoundel size={22} />
            <View style={{ flex: 1 }}>
              <Txt variant="smStrong">গণপ্রজাতন্ত্রী বাংলাদেশ সরকার</Txt>
              <Txt variant="xs" tone="muted" style={{ letterSpacing: 0.5 }}>
                National Women Safety Service
              </Txt>
            </View>
          </View>

          {/* Brand */}
          <View style={{ alignItems: 'center', marginBottom: spacing.xl }}>
            <Image
              source={require('../../../assets/icon.png')}
              style={[
                { width: 104, height: 104, borderRadius: radius.xl, marginBottom: spacing.md },
                shadows.card,
              ]}
              resizeMode="contain"
            />
            <Txt variant="h1" center>
              নারী সুরক্ষা
            </Txt>
            <Txt variant="sm" tone="muted" center style={{ marginTop: 4 }}>
              Help is one press away
            </Txt>
          </View>

          <Card elevation="raised" style={{ padding: spacing.lg }}>
            <Txt variant="h2">Welcome back</Txt>
            <Txt variant="sm" tone="muted" style={{ marginTop: 4, marginBottom: spacing.lg }}>
              Sign in to reach your trusted contacts and the police instantly.
            </Txt>

            <Field
              label="Phone number"
              placeholder="01700000000"
              keyboardType="phone-pad"
              autoCapitalize="none"
              autoComplete="tel"
              value={phone}
              onChangeText={(t) => {
                setPhone(t);
                if (error) setError(null);
              }}
              icon={(c) => <Phone size={18} color={c} />}
              hint="Bangladeshi numbers starting 01… get +88 added for you."
            />

            <Field
              label="Password"
              placeholder="Enter your password"
              secureTextEntry={!reveal}
              autoComplete="current-password"
              value={password}
              onChangeText={(t) => {
                setPassword(t);
                if (error) setError(null);
              }}
              icon={(c) => <Lock size={18} color={c} />}
              error={error ?? undefined}
              trailing={
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={reveal ? 'Hide password' : 'Show password'}
                  onPress={() => setReveal((v) => !v)}
                  hitSlop={10}
                >
                  {reveal ? (
                    <EyeOff size={18} color={colors.textMuted} />
                  ) : (
                    <Eye size={18} color={colors.textMuted} />
                  )}
                </Pressable>
              }
            />

            <Button
              label="Log in"
              size="lg"
              loading={loading}
              onPress={handleLogin}
              iconRight={!loading ? <ArrowRight size={19} color={colors.onFill} /> : undefined}
              style={{ marginTop: spacing.sm }}
            />

            <Pressable
              onPress={() => navigation.navigate('Register')}
              style={{
                flexDirection: 'row',
                justifyContent: 'center',
                marginTop: spacing.lg,
                paddingVertical: spacing.xs,
              }}
              hitSlop={8}
            >
              <Txt variant="sm" tone="muted">
                New here?{' '}
              </Txt>
              <Txt variant="smStrong" tone="accent">
                Create an account →
              </Txt>
            </Pressable>
          </Card>

          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: spacing.sm,
              marginTop: spacing.xl,
            }}
          >
            <FlagRoundel size={14} />
            <Txt variant="xs" tone="muted">
              জাতীয় নারী নিরাপত্তা সেবা · Govt. of Bangladesh
            </Txt>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}
