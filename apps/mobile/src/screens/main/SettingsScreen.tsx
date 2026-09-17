import React, { useState } from 'react';
import { Alert, Switch, View } from 'react-native';
import {
  Activity,
  Bell,
  ChevronRight,
  Lock,
  LogOut,
  Mic,
  Palette,
  Share2,
  Shield,
} from 'lucide-react-native';

import { Screen, Card, ListRow, RowDivider, SectionLabel, Txt, Button, AppBar } from '../../components/ui';
import ThemeModeControl from '../../components/ThemeModeControl';
import { useAuthStore } from '../../store/authStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useTheme } from '../../theme';
import { spacing } from '../../theme/tokens';

export default function SettingsScreen() {
  const { colors } = useTheme();
  const { logout } = useAuthStore();
  const {
    mlVoiceEnabled,
    mlGyroEnabled,
    mlDataSharingEnabled,
    setMlVoiceEnabled,
    setMlGyroEnabled,
    setMlDataSharingEnabled,
  } = useSettingsStore();

  // TODO: these two are still local-only — the switch moves but nothing
  // downstream reads it. Wiring them to the notification registration and the
  // background location task is tracked separately.
  const [notifications, setNotifications] = useState(true);
  const [locationSharing, setLocationSharing] = useState(true);

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
    Alert.alert('Log out?', 'You will stop receiving alerts on this device until you sign in again.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log out', style: 'destructive', onPress: logout },
    ]);
  };

  return (
    <Screen>
      <AppBar title="Settings" subtitle="Appearance, alerts and detection" />

      {/* ── Appearance ─────────────────────────────────────────────── */}
      <SectionLabel>Appearance</SectionLabel>
      <Card padded={false}>
        <ListRow
          title="Theme"
          subtitle="Choose light, dark, or match your phone"
          icon={<Palette size={19} color={colors.accent} />}
          chevron={false}
        />
        <View style={{ paddingHorizontal: spacing.md, paddingBottom: spacing.md }}>
          <ThemeModeControl />
        </View>
      </Card>

      {/* ── Alerts ─────────────────────────────────────────────────── */}
      <SectionLabel>Alerts</SectionLabel>
      <Card padded={false}>
        <ListRow
          title="Push notifications"
          subtitle="Dispatch updates and responder replies"
          icon={<Bell size={19} color={colors.accent} />}
          right={themedSwitch(notifications, setNotifications)}
        />
        <RowDivider />
        <ListRow
          title="Background location"
          subtitle="Shared only while an SOS is active"
          icon={<Shield size={19} color={colors.accent} />}
          right={themedSwitch(locationSharing, setLocationSharing)}
        />
      </Card>

      {/* ── On-device detection ────────────────────────────────────── */}
      <SectionLabel>On-device detection</SectionLabel>
      <Card padded={false}>
        <ListRow
          title="Voice distress detection"
          subtitle="Runs on this phone. Audio never leaves the device."
          icon={<Mic size={19} color={colors.accent} />}
          right={themedSwitch(mlVoiceEnabled, setMlVoiceEnabled)}
        />
        <RowDivider />
        <ListRow
          title="Fall & struggle detection"
          subtitle="Uses the motion sensors to spot a sudden fall"
          icon={<Activity size={19} color={colors.accent} />}
          right={themedSwitch(mlGyroEnabled, setMlGyroEnabled)}
        />
        <RowDivider />
        <ListRow
          title="Help improve detection"
          subtitle="Share anonymised sensor windows. Optional."
          icon={<Share2 size={19} color={colors.accent} />}
          right={themedSwitch(mlDataSharingEnabled, setMlDataSharingEnabled)}
        />
      </Card>

      {/* ── Account ────────────────────────────────────────────────── */}
      <SectionLabel>Account</SectionLabel>
      <Card padded={false}>
        <ListRow
          title="Change password"
          icon={<Lock size={19} color={colors.accent} />}
          right={<ChevronRight size={18} color={colors.textMuted} />}
          onPress={() =>
            Alert.alert('Change password', 'This opens the password form once it is wired up.')
          }
        />
      </Card>

      <View style={{ marginTop: spacing.xl, gap: spacing.sm }}>
        <Button
          label="Log out"
          variant="subtle"
          onPress={confirmLogout}
          icon={<LogOut size={17} color={colors.dangerText} />}
          labelColor={colors.dangerText}
        />
        <Txt variant="xs" tone="muted" center>
          নারী সুরক্ষা · National Women Safety Service
        </Txt>
      </View>
    </Screen>
  );
}
