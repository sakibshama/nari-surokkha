/**
 * Emergency detection settings — one card per trigger (Shout, "Help", Crying,
 * "Bachao"), each with its own switch and sensitivity, plus the master switch,
 * background listening, permissions, a live test meter and the alert history.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, Platform, StyleSheet, Switch, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  Activity,
  Baby,
  Bell,
  Ear,
  History,
  MapPin,
  Megaphone,
  Mic,
  MoonStar,
  Settings2,
  ShieldCheck,
  Timer,
  Volume2,
} from 'lucide-react-native';
import {
  AppBar,
  Badge,
  Button,
  Card,
  FadeIn,
  ListRow,
  RowDivider,
  Screen,
  SectionLabel,
  SegmentedControl,
  Txt,
} from '../../components/ui';
import { useTheme } from '../../theme';
import { useT } from '../../i18n';
import { radius, spacing } from '../../theme/tokens';
import { MainStackParamList } from '../../navigation/MainStack';
import { Sensitivity, TriggerId, TRIGGERS, TRIGGER_RULES, SOFT_ALERT_SECONDS } from '../../services/emergency/constants';
import { useDetectionSettings } from '../../services/emergency/detectionSettings';
import { useDetectorStatus, useLiveScores } from '../../services/emergency/hooks';
import {
  DetectionPermissions,
  getDetectionPermissions,
  requestBackgroundLocation,
  requestLocation,
  requestMicrophone,
  requestNotifications,
} from '../../services/emergency/permissions';
import { isBackgroundServiceSupported } from '../../services/emergency/backgroundMonitor';
import { requestDetectionResync } from '../../components/EmergencyRuntime';
import { softAlerts } from '../../services/emergency/runtime';

type Nav = NativeStackNavigationProp<MainStackParamList>;

const TRIGGER_META: Record<TriggerId, { title: string; desc: string; icon: React.ComponentType<{ color: string; size: number }> }> = {
  shout: { title: 'Shout / scream', desc: 'A loud shout, yell or scream', icon: Megaphone },
  help: { title: '"Help"', desc: 'The word "Help" said or shouted (English)', icon: Volume2 },
  cry: { title: 'Crying', desc: 'Sobbing, wailing or crying (an infant crying is ignored)', icon: Baby },
  bachao: { title: '"Bachao" (বাঁচাও)', desc: 'The word বাঁচাও said or shouted (Bangla)', icon: Volume2 },
};

const COOLDOWNS = [
  { value: '30000', label: '30s' },
  { value: '60000', label: '1m' },
  { value: '300000', label: '5m' },
];

function Meter({ value, threshold, color }: { value: number; threshold: number; color: string }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.meter, { backgroundColor: colors.surfaceAlt }]}>
      <View style={[styles.meterFill, { width: `${Math.round(Math.min(1, value) * 100)}%`, backgroundColor: value >= threshold ? colors.danger : color }]} />
      <View style={[styles.meterMark, { left: `${threshold * 100}%`, backgroundColor: colors.text }]} />
    </View>
  );
}

export default function EmergencyDetectionScreen() {
  const { colors } = useTheme();
  const t = useT();
  const navigation = useNavigation<Nav>();
  const settings = useDetectionSettings();
  const status = useDetectorStatus();
  const [testing, setTesting] = useState(false);
  const live = useLiveScores(testing);
  const [perms, setPerms] = useState<DetectionPermissions | null>(null);

  const refreshPerms = useCallback(async () => {
    setPerms(await getDetectionPermissions());
  }, []);

  useEffect(() => {
    void refreshPerms();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') {
        void refreshPerms();
        requestDetectionResync();
      }
    });
    return () => sub.remove();
  }, [refreshPerms]);

  const switchEl = (value: boolean, onChange: (v: boolean) => void, disabled = false) => (
    <Switch
      value={value}
      onValueChange={onChange}
      disabled={disabled}
      trackColor={{ false: colors.borderStrong, true: colors.accent }}
      thumbColor={colors.surface}
      ios_backgroundColor={colors.borderStrong}
    />
  );

  const fixPermission = async (kind: keyof DetectionPermissions) => {
    const current = perms?.[kind];
    if (current === 'denied') {
      await Linking.openSettings();
      return;
    }
    if (kind === 'microphone') await requestMicrophone();
    else if (kind === 'notifications') await requestNotifications();
    else if (kind === 'location') await requestLocation();
    else await requestBackgroundLocation();
    await refreshPerms();
    requestDetectionResync();
  };

  const statusBadge = (() => {
    if (Platform.OS === 'web') return <Badge label={t('Phone app only')} tone="neutral" />;
    switch (status.state) {
      case 'listening':
        return <Badge label={t('Listening')} tone="success" icon={<Ear size={13} color={colors.successText} />} />;
      case 'starting':
        return <Badge label={t('Starting…')} tone="warning" />;
      case 'paused':
        return <Badge label={status.reason === 'sos_active' ? t('Paused during SOS') : t('Paused in background')} tone="warning" />;
      case 'error':
        return <Badge label={t('Error')} tone="danger" />;
      default:
        return <Badge label={t('Off')} tone="neutral" />;
    }
  })();

  const permRow = (kind: keyof DetectionPermissions, title: string, subtitle: string, Icon: typeof Mic) => {
    const st = perms?.[kind] ?? 'undetermined';
    const ok = st === 'granted';
    return (
      <ListRow
        title={title}
        subtitle={subtitle}
        icon={<Icon size={19} color={ok ? colors.success : colors.warning} />}
        right={
          ok ? (
            <Badge label={t('Allowed')} tone="success" />
          ) : st === 'unavailable' ? (
            <Badge label={t('Unavailable')} tone="neutral" />
          ) : (
            <Button label={st === 'denied' ? t('Open settings') : t('Allow')} size="sm" full={false} onPress={() => fixPermission(kind)} />
          )
        }
      />
    );
  };

  return (
    <Screen>
      <AppBar title={t('Emergency detection')} subtitle={t('Hands-free alerts from your voice and surroundings')} />

      {/* ── Master ─────────────────────────────────────────── */}
      <Card padded={false} delay={20}>
        <ListRow
          title={t('Listen for emergencies')}
          subtitle={t('Runs on this phone. Audio is never recorded or uploaded.')}
          icon={<ShieldCheck size={19} color={colors.accent} />}
          right={switchEl(settings.enabled, settings.setEnabled, Platform.OS === 'web')}
        />
        <RowDivider />
        <View style={styles.statusRow}>
          <Txt variant="sm" tone="sub">{t('Status')}</Txt>
          {statusBadge}
        </View>
        {status.state === 'error' && (
          <View style={{ paddingHorizontal: spacing.md, paddingBottom: spacing.md }}>
            <Txt variant="xs" tone="danger">{status.message}</Txt>
            <Txt variant="xs" tone="muted" style={{ marginTop: 4 }}>
              {t('Detection needs a development or store build of the app (not Expo Go) with microphone permission.')}
            </Txt>
          </View>
        )}
        <RowDivider />
        <ListRow
          title={t('Keep listening in the background')}
          subtitle={
            Platform.OS === 'android'
              ? t('Shows a permanent "listening" notification (Android requires it). Uses more battery.')
              : t('Keeps listening while another app is open. Uses more battery.')
          }
          icon={<MoonStar size={19} color={colors.accent} />}
          right={switchEl(
            settings.background,
            settings.setBackground,
            !settings.enabled || (Platform.OS === 'android' && !isBackgroundServiceSupported()),
          )}
        />
      </Card>

      {/* ── Per-trigger controls ───────────────────────────── */}
      <SectionLabel>{t('What starts an alert')}</SectionLabel>
      {TRIGGERS.map((id, i) => {
        const meta = TRIGGER_META[id];
        const cfg = settings.triggers[id];
        const rule = TRIGGER_RULES[id][cfg.sensitivity];
        const Icon = meta.icon;
        return (
          <Card key={id} padded={false} delay={60 + i * 40} style={{ marginBottom: spacing.sm }}>
            <ListRow
              title={t(meta.title)}
              subtitle={t(meta.desc)}
              icon={<Icon size={19} color={cfg.enabled ? colors.accent : colors.textMuted} />}
              right={switchEl(cfg.enabled, (v) => settings.setTriggerEnabled(id, v), !settings.enabled)}
            />
            {cfg.enabled && settings.enabled && (
              <View style={{ paddingHorizontal: spacing.md, paddingBottom: spacing.md, gap: spacing.sm }}>
                <Txt variant="xs" tone="muted">{t('Sensitivity')}</Txt>
                <SegmentedControl<Sensitivity>
                  segments={[
                    { value: 'low', label: t('Low') },
                    { value: 'medium', label: t('Medium') },
                    { value: 'high', label: t('High') },
                  ]}
                  value={cfg.sensitivity}
                  onChange={(v) => settings.setSensitivity(id, v)}
                />
                {testing && (
                  <Meter value={live?.[id] ?? 0} threshold={rule.threshold} color={colors.accent} />
                )}
              </View>
            )}
          </Card>
        );
      })}

      {/* ── Test ───────────────────────────────────────────── */}
      <SectionLabel>{t('Test')}</SectionLabel>
      <Card delay={240}>
        <Txt variant="sm" tone="sub">
          {t('Live meters show what the models hear. A bar crossing the mark counts as a hit; alerts still follow the rules above.')}
        </Txt>
        {testing && live && (
          <Txt variant="xs" tone="muted" style={{ marginTop: spacing.xs }}>
            {t('Input level: {db} dB', { db: Math.round(live.levelDb) })}
          </Txt>
        )}
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
          <Button
            label={testing ? t('Hide live meters') : t('Show live meters')}
            variant="subtle"
            full={false}
            style={{ flex: 1 }}
            disabled={status.state !== 'listening'}
            icon={<Activity size={16} color={colors.text} />}
            onPress={() => setTesting((v) => !v)}
          />
          <Button
            label={t('Test alert')}
            variant="outline"
            full={false}
            style={{ flex: 1 }}
            icon={<Timer size={16} color={colors.text} />}
            onPress={() => softAlerts.trigger('manual', { manual: true })}
          />
        </View>
        <Txt variant="xs" tone="muted" style={{ marginTop: spacing.sm }}>
          {t('"Test alert" starts a real {n}-second soft alert. Tap "I\'m okay" to stop it before it is sent.', { n: SOFT_ALERT_SECONDS })}
        </Txt>
      </Card>

      {/* ── After an alert ─────────────────────────────────── */}
      <SectionLabel>{t('After "I\'m okay"')}</SectionLabel>
      <Card delay={280}>
        <Txt variant="sm" tone="sub" style={{ marginBottom: spacing.sm }}>
          {t('Ignore automatic detections for')}
        </Txt>
        <SegmentedControl
          segments={COOLDOWNS.map((c) => ({ value: c.value, label: c.label }))}
          value={String(settings.cooldownMs)}
          onChange={(v) => settings.setCooldownMs(Number(v))}
        />
      </Card>

      {/* ── Permissions ────────────────────────────────────── */}
      <SectionLabel>{t('Permissions')}</SectionLabel>
      <Card padded={false} delay={320}>
        {permRow('microphone', t('Microphone'), t('Needed to hear an emergency'), Mic)}
        <RowDivider />
        {permRow('notifications', t('Notifications'), t('Shows the countdown when the screen is off'), Bell)}
        <RowDivider />
        {permRow('location', t('Location'), t('Sent with the alert so help can find you'), MapPin)}
        <RowDivider />
        {permRow('backgroundLocation', t('Location while in background'), t('Live tracking after an automatic SOS'), MapPin)}
      </Card>

      {/* ── History ────────────────────────────────────────── */}
      <Card padded={false} delay={360} style={{ marginTop: spacing.md }}>
        <ListRow
          title={t('Alert history')}
          subtitle={t('Every detection, and how it ended')}
          icon={<History size={19} color={colors.accent} />}
          onPress={() => navigation.navigate('AlertHistory')}
        />
      </Card>

      <FadeIn delay={400} style={{ marginTop: spacing.lg }}>
        <View style={[styles.note, { borderColor: colors.border, backgroundColor: colors.surfaceAlt }]}>
          <Settings2 size={16} color={colors.textMuted} />
          <Txt variant="xs" tone="muted" style={{ flex: 1 }}>
            {t(
              'Detection is an extra safety net, not a guarantee. It can miss a quiet or distant voice and can be fooled by TV or loud games. Keep the SOS button as your first option.',
            )}
          </Txt>
        </View>
      </FadeIn>
    </Screen>
  );
}

const styles = StyleSheet.create({
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  meter: { height: 10, borderRadius: radius.full, overflow: 'hidden', marginTop: spacing.xs },
  meterFill: { height: '100%', borderRadius: radius.full },
  meterMark: { position: 'absolute', top: 0, bottom: 0, width: 2, opacity: 0.6 },
  note: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    alignItems: 'flex-start',
  },
});
