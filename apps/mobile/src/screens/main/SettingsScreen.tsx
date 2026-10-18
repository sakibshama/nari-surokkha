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
  MessageSquare,
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
import { signOut } from '../../services/signOut';
import { registerDeviceTokenWithServer, unregisterPush } from '../../services/pushNotifications';
import { refreshLocationTracking } from '../../services/backgroundTasks';
import { useSettingsStore } from '../../store/settingsStore';
import { ensureSmsPermission, useSmsPermission } from '../../services/smsPermission';
import { useTheme } from '../../theme';
import { useT } from '../../i18n';
import { spacing } from '../../theme/tokens';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { MainStackParamList } from '../../navigation/MainStack';

export default function SettingsScreen() {
  const { colors } = useTheme();
  const t = useT();
  const smsState = useSmsPermission((st) => st.state);
  React.useEffect(() => {
    void useSmsPermission.getState().refresh();
  }, []);
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const {
    mlGyroEnabled,
    mlDataSharingEnabled,
    pushEnabled,
    backgroundLocationEnabled,
    setMlGyroEnabled,
    setMlDataSharingEnabled,
    setPushEnabled,
    setBackgroundLocationEnabled,
  } = useSettingsStore();
  const [pushBusy, setPushBusy] = useState(false);
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

  /** Really (un)register this device for push, not just flip a flag. */
  const togglePush = async (on: boolean) => {
    setPushBusy(true);
    try {
      if (on) {
        const ok = await registerDeviceTokenWithServer();
        if (!ok) {
          showAlert(t('Notifications are off'), t('Allow notifications for Nari Surokkha in your phone settings, then try again.'));
          return;
        }
      } else {
        await unregisterPush();
      }
      setPushEnabled(on);
    } catch {
      showAlert(t('Error'), t('Could not update notifications. Check your connection.'));
    } finally {
      setPushBusy(false);
    }
  };

  /** Off → location is tracked only while the app is open. Applies to a running SOS too. */
  const toggleBackgroundLocation = (on: boolean) => {
    setBackgroundLocationEnabled(on);
    void refreshLocationTracking();
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
      { text: t('Log out'), style: 'destructive', onPress: () => void signOut() },
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
          right={pushBusy ? <ActivityIndicator color={colors.accent} /> : themedSwitch(pushEnabled, (v) => void togglePush(v))}
        />
        <RowDivider />
        <ListRow
          title={t('Background location')}
          subtitle={
            backgroundLocationEnabled
              ? t('During an SOS or safe route, also while the app is closed')
              : t('Only while the app is open')
          }
          icon={<Shield size={19} color={colors.accent} />}
          right={themedSwitch(backgroundLocationEnabled, toggleBackgroundLocation)}
        />
        {smsState !== 'unsupported' && (
          <>
            <RowDivider />
            <ListRow
              title={t('Emergency SMS')}
              subtitle={
                smsState === 'granted'
                  ? t('Allowed — offline SOS texts your contacts automatically')
                  : t('Not allowed — tap to turn on')
              }
              icon={<MessageSquare size={19} color={smsState === 'granted' ? colors.accent : colors.danger} />}
              onPress={smsState === 'granted' ? undefined : () => void ensureSmsPermission(true)}
            />
          </>
        )}
      </Card>

      {/* ── On-device detection ────────────────────────────────────── */}
      <SectionLabel>{t('On-device detection')}</SectionLabel>
      <Card padded={false} delay={160}>
        <ListRow
          title={t('Emergency sound detection')}
          subtitle={t('Shout, cry, "Help", "Bachao" — switches, sensitivity, history')}
          icon={<Mic size={19} color={colors.accent} />}
          onPress={() => navigation.navigate('EmergencyDetection')}
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
        {/* Pointing the app at another server is a developer tool only. */}
        {__DEV__ && (
          <ListRow
            title={t('Server address')}
            subtitle={target}
            icon={<Server size={19} color={colors.accent} />}
            onPress={() => {
              setDraft(target);
              setEditing((v) => !v);
            }}
          />
        )}

        {__DEV__ && editing && (
          <View style={{ paddingHorizontal: spacing.md, paddingBottom: spacing.md }}>
            <Field
              value={draft}
              onChangeText={setDraft}
              placeholder="http://192.168.0.10:3000"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              hint={t('Include the port, e.g. 3000. The app adds /api/v1 for you.')}
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

        {__DEV__ && <RowDivider />}
        <ListRow
          title={t('Check server connection')}
          subtitle={t('Confirm an SOS can reach the server')}
          icon={<Shield size={19} color={colors.accent} />}
          onPress={checking ? undefined : checkConnection}
          right={checking ? <ActivityIndicator color={colors.accent} /> : undefined}
        />
        {__DEV__ && (
          <>
            <RowDivider />
            <ListRow
              title={t('Detect server automatically')}
              subtitle={t('Try this phone, your computer and the emulator')}
              icon={<Wand2 size={19} color={colors.accent} />}
              onPress={checking ? undefined : autoDetect}
            />
          </>
        )}
      </Card>

      {/* ── Account ────────────────────────────────────────────────── */}
      <SectionLabel>{t('Account')}</SectionLabel>
      <Card padded={false} delay={220}>
        <ListRow
          title={t('Change password')}
          icon={<Lock size={19} color={colors.accent} />}
          onPress={() => navigation.navigate('ChangePassword')}
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
