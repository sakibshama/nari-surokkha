import React, { useState } from 'react';
import { Pressable } from 'react-native';
import { Eye, EyeOff, KeyRound, Lock } from 'lucide-react-native';

import api from '../../services/api';
import { signOut } from '../../services/signOut';
import { AppBar, Button, Card, Field, Screen, Txt } from '../../components/ui';
import { showAlert } from '../../utils/notify';
import { useTheme } from '../../theme';
import { useT } from '../../i18n';
import { spacing } from '../../theme/tokens';

const MIN_LENGTH = 8;

/** POST /auth/change-password. The server signs out every session, so this one signs in again. */
export default function ChangePasswordScreen() {
  const { colors } = useTheme();
  const t = useT();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [reveal, setReveal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!current || !next) return setError(t('Please fill all required fields.'));
    if (next.length < MIN_LENGTH) return setError(t('The new password needs at least {n} characters.', { n: MIN_LENGTH }));
    if (next !== confirm) return setError(t('Passwords do not match.'));
    if (next === current) return setError(t('Choose a password different from the current one.'));
    setError(null);
    setSaving(true);
    try {
      await api.post('/auth/change-password', { currentPassword: current, newPassword: next });
      showAlert(t('Password changed'), t('Please log in again with your new password.'), [
        { text: t('OK'), onPress: () => void signOut({ revoke: false }) },
      ]);
    } catch (e) {
      const err = e as { response?: { data?: { error?: { message?: string } } } };
      setError(err.response?.data?.error?.message || t('Something went wrong. Please try again.'));
    } finally {
      setSaving(false);
    }
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
    <Screen>
      <AppBar title={t('Change password')} subtitle={t('You will be signed out on all devices.')} />
      <Card elevation="raised">
        <Field
          label={t('Current password')}
          secureTextEntry={!reveal}
          autoComplete="current-password"
          value={current}
          onChangeText={setCurrent}
          icon={(c) => <Lock size={18} color={c} />}
          trailing={revealToggle}
        />
        <Field
          label={t('New password')}
          secureTextEntry={!reveal}
          autoComplete="new-password"
          value={next}
          onChangeText={setNext}
          hint={t('At least {n} characters.', { n: MIN_LENGTH })}
          icon={(c) => <KeyRound size={18} color={c} />}
        />
        <Field
          label={t('Confirm password')}
          secureTextEntry={!reveal}
          autoComplete="new-password"
          value={confirm}
          onChangeText={setConfirm}
          error={error ?? undefined}
          icon={(c) => <KeyRound size={18} color={c} />}
        />
        <Button label={t('Change password')} onPress={submit} loading={saving} style={{ marginTop: spacing.sm }} />
        <Txt variant="xs" tone="muted" center style={{ marginTop: spacing.md }}>
          {t('After the change, log in again on this phone.')}
        </Txt>
      </Card>
    </Screen>
  );
}
