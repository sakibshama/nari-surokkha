/**
 * Offline SOS.
 *
 * Shown when an SOS is pressed with no internet. It is deliberately honest:
 * it reports what actually happened to the SMS fallback (from the on-device
 * SMS history) instead of simulating a network that does not exist, and it
 * notices when the connection comes back so the user can send the full
 * online SOS with live tracking.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { showAlert } from '../../utils/notify';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import NetInfo from '@react-native-community/netinfo';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { AlertTriangle, CheckCircle, History, Phone, RefreshCw, Send, Wifi, WifiOff } from 'lucide-react-native';

import { MainStackParamList } from '../../navigation/MainStack';
import { sendOfflineSosSms } from '../../services/offlineSos';
import { useAuthStore } from '../../store/authStore';
import { getSmsHistory, type SmsHistoryEntry } from '../../services/smsHistory';
import { useTheme } from '../../theme';
import { useT } from '../../i18n';
import { radius, spacing } from '../../theme/tokens';
import { Breathing, Button, Card, FadeIn, PulseRings, Txt } from '../../components/ui';

type Props = NativeStackScreenProps<MainStackParamList, 'OfflineSos'>;

export default function OfflineSosScreen({ navigation }: Props) {
  const { colors, gradients } = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const [online, setOnline] = useState(false);
  const [last, setLast] = useState<SmsHistoryEntry | null>(null);
  const [sending, setSending] = useState(false);

  const refreshHistory = useCallback(async () => {
    const list = await getSmsHistory();
    setLast(list.find((e) => e.channel === 'offline-sim') ?? null);
  }, []);

  useFocusEffect(
    useCallback(() => {
      refreshHistory();
    }, [refreshHistory]),
  );

  useEffect(() => {
    const unsub = NetInfo.addEventListener((s) => setOnline(!!s.isConnected));
    return () => unsub();
  }, []);

  const resend = async () => {
    setSending(true);
    try {
      // Same text as the first SMS, including who is asking for help.
      const result = await sendOfflineSosSms({ userName: useAuthStore.getState().user?.profile?.fullName });
      await refreshHistory();
      if (result.opened && !result.auto) {
        showAlert(t('Review & send'), t('Your Messages app opened with the SOS text ready — tap Send to dispatch it.'));
      } else if (!result.opened) {
        showAlert(t('Offline'), `${result.reason || t('SMS is not available on this device.')} ${t('Please call 999 directly.')}`);
      }
    } finally {
      setSending(false);
    }
  };

  const delivered = last && last.status !== 'failed';
  const statusText = !last
    ? t('No emergency SMS has been sent yet.')
    : last.status === 'auto'
      ? t('Emergency SMS sent automatically to {n} contact(s).', { n: last.recipients.length })
      : last.status === 'manual'
        ? t('Messages app opened — make sure you tapped Send.')
        : t('SMS could not be sent: {reason}', { reason: last.reason || t('unknown error') });

  return (
    <LinearGradient colors={gradients.hero} style={{ flex: 1 }}>
      <View style={[styles.root, { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.lg }]}>
        <FadeIn from="up" style={{ alignItems: 'center' }}>
          <View
            style={[
              styles.badge,
              { backgroundColor: online ? colors.successSoft : colors.warningSoft, borderColor: online ? colors.success : colors.warning },
            ]}
          >
            {online ? <Wifi color={colors.successText} size={16} /> : <WifiOff color={colors.warningText} size={16} />}
            <Txt variant="label" style={{ color: online ? colors.successText : colors.warningText, textTransform: 'uppercase' }}>
              {online ? t('Back online') : t('Offline mode')}
            </Txt>
          </View>
          <Txt variant="h1" center style={{ marginTop: spacing.md }}>
            {online ? t('Connection restored') : t('No internet connection')}
          </Txt>
          <Txt variant="sm" tone="muted" center style={{ marginTop: 4, paddingHorizontal: spacing.lg }}>
            {online
              ? t('Your SOS is sent online automatically so your contacts get live tracking. You can also send it now.')
              : t('Your SOS goes out by SMS over the mobile network. We will tell you when the internet is back.')}
          </Txt>
        </FadeIn>

        {/* Beacon */}
        <View style={styles.beacon}>
          <PulseRings color={online ? colors.success : colors.warning} size={190} count={3} duration={2600} />
          <Breathing min={0.96} max={1.04} duration={1300}>
            <LinearGradient
              colors={online ? gradients.accent : gradients.warning}
              style={styles.beaconCore}
            >
              {online ? <Wifi color="#fff" size={40} /> : <Send color="#fff" size={38} />}
            </LinearGradient>
          </Breathing>
        </View>

        {/* Status */}
        <Animated.View key={last?.id ?? 'none'} entering={FadeInDown.duration(300)}>
          <Card tone={!last ? 'neutral' : delivered ? 'success' : 'danger'} style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
            {delivered ? (
              <CheckCircle color={colors.successText} size={20} />
            ) : (
              <AlertTriangle color={last ? colors.dangerText : colors.textMuted} size={20} />
            )}
            <Txt variant="sm" style={{ flex: 1 }}>{statusText}</Txt>
          </Card>
        </Animated.View>

        <View style={{ gap: spacing.sm, marginTop: spacing.lg }}>
          {online ? (
            <FadeIn>
              <Button
                label={t('Go back and send online SOS')}
                variant="danger"
                size="lg"
                onPress={() => navigation.navigate('Home')}
                icon={<RefreshCw color={colors.onDanger} size={18} />}
              />
            </FadeIn>
          ) : (
            <FadeIn delay={80}>
              <Button
                label={last ? t('Send SMS again') : t('Send emergency SMS')}
                variant="danger"
                size="lg"
                loading={sending}
                onPress={resend}
                icon={<Send color={colors.onDanger} size={18} />}
              />
            </FadeIn>
          )}
          <FadeIn delay={140} style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Button
              label={t('Call 999')}
              variant="subtle"
              full={false}
              style={{ flex: 1 }}
              onPress={() => Linking.openURL('tel:999')}
              icon={<Phone color={colors.dangerText} size={17} />}
            />
            <Button
              label={t('SMS history')}
              variant="subtle"
              full={false}
              style={{ flex: 1 }}
              onPress={() => navigation.navigate('SmsHistory')}
              icon={<History color={colors.text} size={17} />}
            />
          </FadeIn>
          <Button label={t('Close')} variant="ghost" onPress={() => navigation.goBack()} />
        </View>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: spacing.lg, justifyContent: 'space-between' },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  beacon: { height: 240, alignItems: 'center', justifyContent: 'center' },
  beaconCore: {
    width: 104,
    height: 104,
    borderRadius: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.35)',
  },
});
