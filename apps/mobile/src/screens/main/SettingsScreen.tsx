import React, { useState } from 'react';
import { Switch, View } from 'react-native';
import { showAlert } from '../../utils/notify';
import {
  Activity,
  Bell,
  Languages,
  Lock,
  LogOut,
  Mic,
  Palette,
  Share2,
  Shield,
} from 'lucide-react-native';

import { Screen, Card, ListRow, RowDivider, SectionLabel, Txt, Button, AppBar, FadeIn } from '../../components/ui';
import ThemeModeControl from '../../components/ThemeModeControl';
import LanguageToggle from '../../components/LanguageToggle';
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
