import React, { useState } from 'react';
import { ActivityIndicator, Switch, View } from 'react-native';
import { Field } from '../../components/ui';
import { showAlert } from '../../utils/notify';
import {
  Activity,
  Bell,
  Check,
  Languages,
  Lock,
  LogOut,
  Mic,
  Palette,
  RotateCcw,
  Server,
  Share2,
  Shield,
  Wand2,
} from 'lucide-react-native';

import { Screen, Card, ListRow, RowDivider, SectionLabel, Txt, Button, AppBar, FadeIn } from '../../components/ui';
import ThemeModeControl from '../../components/ThemeModeControl';
import LanguageToggle from '../../components/LanguageToggle';
import api, { describeApiTarget, initApiTarget, probe, setApiBaseUrl } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useTheme } from '../../theme';
import { useT } from '../../i18n';
import { spacing } from '../../theme/tokens';

export default function SettingsScreen() {
  const { colors } = useTheme();
  const t = useT();
  const { logout } = useAuthStore();
  const {
    mlVoiceEnabled,
    mlGyroEnabled,
    mlDataSharingEnabled,
    setMlVoiceEnabled,
    setMlGyroEnabled,
    setMlDataSharingEnabled,
  } = useSettingsStore();

  // TODO: these two are still local-only — nothing downstream reads them yet.
  const [notifications, setNotifications] = useState(true);
  const [locationSharing, setLocationSharing] = useState(true);
  const [checking, setChecking] = useState(false);
  const [target, setTarget] = useState(describeApiTarget());
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(describeApiTarget());

  /**
   * One-tap connection check. An SOS that cannot reach the server is the
   * failure that matters most, so make it testable before an emergency.
   */
  const checkConnection = async () => {
    setChecking(true);
    const current = describeApiTarget();
    try {
      const res = await api.get('/ping', { timeout: 8000 });
      if (res.data?.message === 'pong') {
        showAlert(t('Server reachable'), `${current}\n${t('The app can send an SOS.')}`);
      } else {
        showAlert(t('Unexpected reply'), `${current}\n${t('The server answered, but not as expected. Check the API URL.')}`);
      }
    } catch (e: any) {
      const status = e?.response?.status;
      showAlert(
        t('Cannot reach the server'),
        `${current}\n${status ? `HTTP ${status}` : e?.message || t('No response.')}`,
      );
    } finally {
      setChecking(false);
    }
  };

  /** Re-run auto-detection (clears any saved address first). */
  const autoDetect = async () => {
    setChecking(true);
    try {
      await setApiBaseUrl(null);
      const found = await initApiTarget();
      setTarget(found);
      setDraft(found);
      const ok = await probe(found);
      showAlert(
        ok ? t('Server reachable') : t('Cannot reach the server'),
        `${found}\n${ok ? t('The app can send an SOS.') : t('Enter the address manually below.')}`,
      );
    } finally {
      setChecking(false);
    }
  };

  /** Pin the address the user typed. */
  const saveTarget = async () => {
    setChecking(true);
    try {
      const saved = await setApiBaseUrl(draft);
      setTarget(saved);
      setEditing(false);
      const ok = await probe(saved);
      showAlert(
        ok ? t('Server reachable') : t('Cannot reach the server'),
        `${saved}\n${ok ? t('The app can send an SOS.') : t('Saved, but nothing answered there yet.')}`,
      );
    } finally {
      setChecking(false);
    }
  };

  const themedSwitch = (value: boolean, onChange: (v: boolean) => void) => (
    <Switch
      value={value}
      onValueChange={onChange}
      trackColor={{ false: colors.borderStrong, true: colors.accent }}
      thumbColor={colors.surface}
      ios_backgroundColor={colors.borderStrong}
    />
  );

  const confirmLogout = () => {
    showAlert(t('Log out?'), t('You will stop receiving alerts on this device until you sign in again.'), [
      { text: t('Cancel'), style: 'cancel' },
      { text: t('Log out'), style: 'destructive', onPress: logout },
    ]);
  };

  return (
    <Screen>
      <AppBar title={t('Settings')} subtitle={t('Appearance, language, alerts and detection')} />

      {/* ── Appearance ─────────────────────────────────────────────── */}
      <SectionLabel>{t('Appearance')}</SectionLabel>
      <Card padded={false} delay={40}>
        <ListRow
          title={t('Theme')}
          subtitle={t('Choose light, dark, or match your phone')}
          icon={<Palette size={19} color={colors.accent} />}
          chevron={false}
        />
        <View style={{ paddingHorizontal: spacing.md, paddingBottom: spacing.md }}>
          <ThemeModeControl />
        </View>
        <RowDivider />
        <ListRow
          title={t('Language')}
          subtitle={t('English or Bangla, for every screen')}
          icon={<Languages size={19} color={colors.accent} />}
          chevron={false}
        />
        <View style={{ paddingHorizontal: spacing.md, paddingBottom: spacing.md }}>
          <LanguageToggle size="md" />
        </View>
      </Card>

      {/* ── Alerts ─────────────────────────────────────────────────── */}
      <SectionLabel>{t('Alerts')}</SectionLabel>
      <Card padded={false} delay={100}>
        <ListRow
          title={t('Push notifications')}
          subtitle={t('Dispatch updates and responder replies')}
          icon={<Bell size={19} color={colors.accent} />}
          right={themedSwitch(notifications, setNotifications)}
        />
        <RowDivider />
        <ListRow
          title={t('Background location')}
          subtitle={t('Shared only while an SOS is active')}
          icon={<Shield size={19} color={colors.accent} />}
          right={themedSwitch(locationSharing, setLocationSharing)}
        />
      </Card>

      {/* ── On-device detection ────────────────────────────────────── */}
      <SectionLabel>{t('On-device detection')}</SectionLabel>
      <Card padded={false} delay={160}>
        <ListRow
          title={t('Voice distress detection')}
          subtitle={t('Runs on this phone. Audio never leaves the device.')}
          icon={<Mic size={19} color={colors.accent} />}
          right={themedSwitch(mlVoiceEnabled, setMlVoiceEnabled)}
        />
        <RowDivider />
        <ListRow
          title={t('Fall & struggle detection')}
          subtitle={t('Uses the motion sensors to spot a sudden fall')}
          icon={<Activity size={19} color={colors.accent} />}
          right={themedSwitch(mlGyroEnabled, setMlGyroEnabled)}
        />
        <RowDivider />
        <ListRow
          title={t('Help improve detection')}
          subtitle={t('Share anonymised sensor windows. Optional.')}
          icon={<Share2 size={19} color={colors.accent} />}
          right={themedSwitch(mlDataSharingEnabled, setMlDataSharingEnabled)}
        />
      </Card>

      {/* ── Connection ─────────────────────────────────────────────── */}
      <SectionLabel>{t('Connection')}</SectionLabel>
      <Card padded={false} delay={200}>
        <ListRow
          title={t('Server address')}
          subtitle={target}
          icon={<Server size={19} color={colors.accent} />}
          onPress={() => {
            setDraft(target);
            setEditing((v) => !v);
          }}
        />

        {editing && (
          <View style={{ paddingHorizontal: spacing.md, paddingBottom: spacing.md }}>
            <Field
              value={draft}
              onChangeText={setDraft}
              placeholder="http://192.168.0.10:3001"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              hint={t('The app adds /api/v1 for you.')}
            />
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <Button
                label={t('Save')}
                onPress={saveTarget}
                loading={checking}
                icon={<Check size={17} color={colors.onAccent} />}
                style={{ flex: 1 }}
                full={false}
              />
              <Button
                label={t('Reset')}
                variant="subtle"
                full={false}
                style={{ flex: 1 }}
                onPress={async () => {
                  const reset = await setApiBaseUrl(null);
                  setTarget(reset);
                  setDraft(reset);
                  setEditing(false);
                }}
                icon={<RotateCcw size={16} color={colors.text} />}
              />
            </View>
          </View>
        )}

        <RowDivider />
        <ListRow
          title={t('Check server connection')}
          subtitle={t('Confirm an SOS can reach the server')}
          icon={<Shield size={19} color={colors.accent} />}
          onPress={checking ? undefined : checkConnection}
          right={checking ? <ActivityIndicator color={colors.accent} /> : undefined}
        />
        <RowDivider />
        <ListRow
          title={t('Detect server automatically')}
          subtitle={t('Try this phone, your computer and the emulator')}
          icon={<Wand2 size={19} color={colors.accent} />}
          onPress={checking ? undefined : autoDetect}
        />
      </Card>

      {/* ── Account ────────────────────────────────────────────────── */}
      <SectionLabel>{t('Account')}</SectionLabel>
      <Card padded={false} delay={220}>
        <ListRow
          title={t('Change password')}
          icon={<Lock size={19} color={colors.accent} />}
          onPress={() => showAlert(t('Change password'), t('This opens the password form once it is wired up.'))}
        />
      </Card>

      <FadeIn delay={280} style={{ marginTop: spacing.xl, gap: spacing.sm }}>
        <Button
          label={t('Log out')}
          variant="subtle"
          onPress={confirmLogout}
          icon={<LogOut size={17} color={colors.dangerText} />}
          labelColor={colors.dangerText}
        />
        <Txt variant="xs" tone="muted" center>
          নারী সুরক্ষা · {t('National Women Safety Service')}
        </Txt>
      </FadeIn>
    </Screen>
  );
}
