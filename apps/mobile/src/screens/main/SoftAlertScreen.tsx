import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { MainStackParamList } from '../../navigation/MainStack';
import { LinearGradient } from 'expo-linear-gradient';
import { Theme, useTheme, useThemedStyles } from '../../theme';
import { radius, spacing, type } from '../../theme/tokens';
import Animated, { ZoomIn, useAnimatedStyle, useSharedValue, withTiming, Easing, cancelAnimation } from 'react-native-reanimated';
import { Breathing, FadeIn, PressableScale, PulseRings } from '../../components/ui';
import { useT } from '../../i18n';
import { AlertTriangle, CheckCircle, Loader } from 'lucide-react-native';
import { softAlerts, triggerLabel } from '../../services/emergency/runtime';
import { useSoftAlert } from '../../services/emergency/hooks';
import { SOFT_ALERT_SECONDS } from '../../services/emergency/constants';

type NavigationProp = NativeStackNavigationProp<MainStackParamList>;

/**
 * The 15-second soft alert. The countdown itself lives in SoftAlertManager
 * (so it keeps running with the screen closed or the app in the background);
 * this screen only shows it and offers the two answers.
 */
export default function SoftAlertScreen() {
  // Pinned dark: same alarm register as the active-SOS screen.
  const styles = useThemedStyles(makeStyles, 'dark');
  const { colors, gradients, shadows } = useTheme('dark');
  const t = useT();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<RouteProp<MainStackParamList, 'SoftAlert'>>();
  const alert = useSoftAlert();

  // Opened as "Silent alert" (drawer / shortcuts): start the countdown here.
  useEffect(() => {
    if (route.params?.manual && !softAlerts.active) softAlerts.trigger('manual', { manual: true });
  }, []);
  const manual = alert?.source === 'manual';
  const [remaining, setRemaining] = useState(() => Math.ceil(softAlerts.remainingMs() / 1000));
  const seenAlert = useRef(false);

  const TOTAL = SOFT_ALERT_SECONDS;
  const progress = useSharedValue(Math.max(0, softAlerts.remainingMs()) / (TOTAL * 1000));

  // Tick from the manager's deadline (not a local counter), so the screen and
  // the notification can never disagree about how long is left.
  useEffect(() => {
    const id = setInterval(() => setRemaining(Math.ceil(softAlerts.remainingMs() / 1000)), 250);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (alert?.phase === 'counting') {
      seenAlert.current = true;
      const ms = softAlerts.remainingMs();
      progress.value = ms / (TOTAL * 1000);
      progress.value = withTiming(0, { duration: ms, easing: Easing.linear });
    } else {
      cancelAnimation(progress);
    }
  }, [alert?.id, alert?.phase]);

  // Nothing to show (cancelled from the notification, or opened stale): leave.
  // Sent alerts navigate to the SOS screen from the runtime (replace).
  useEffect(() => {
    if (!alert && navigation.canGoBack()) {
      const id = setTimeout(() => {
        if (!softAlerts.active && navigation.canGoBack()) navigation.goBack();
      }, seenAlert.current ? 0 : 300);
      return () => clearTimeout(id);
    }
  }, [alert]);

  const countdown = Math.max(0, remaining);
  const sending = alert?.phase === 'sending';
  const failed = alert?.phase === 'failed';

  const barStyle = useAnimatedStyle(() => ({ width: `${progress.value * 100}%` }));

  const cancelAlert = () => {
    void softAlerts.cancel();
  };
  const confirmEmergency = () => {
    void softAlerts.confirmNow();
  };
  const dismissFailure = () => {
    softAlerts.dismissFailure();
  };

  const badgeLabel = manual
    ? t('Silent alert armed')
    : alert
    ? t('{trigger} detected', { trigger: triggerLabel(alert.source) })
    : t('Fall / danger detected');

  // Urgency colors
  const urgencyColor = countdown > 10 ? colors.warning : countdown > 5 ? '#f97316' : colors.danger;
  const urgencyGrad: [string, string] = countdown > 10
    ? ['#92400e', colors.warning]
    : countdown > 5
    ? ['#9a3412', '#ea580c']
    : [colors.dangerPressed, colors.danger];

  return (
    <LinearGradient colors={gradients.dangerBackdrop} style={styles.root}>
      <View style={[styles.content, { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.lg }]}>
        {/* Badge */}
        <FadeIn from="up" style={[styles.badge, { borderColor: `${urgencyColor}66`, backgroundColor: `${urgencyColor}1A` }]}>
          <AlertTriangle color={urgencyColor} size={18} />
          <Text style={[styles.badgeText, { color: urgencyColor }]}>
            {badgeLabel}
          </Text>
        </FadeIn>

        <FadeIn delay={80} style={{ alignItems: 'center' }}>
          <Text style={styles.title}>
            {failed ? t('Could not send the alert') : sending ? t('Sending SOS…') : manual ? t('Stay safe') : t('Are you okay?')}
          </Text>
          <Text style={styles.sub}>
            {failed
              ? `${alert?.error ?? ''}\n${t('Call 999 or try the SOS button again.')}`
              : manual
              ? t("A silent countdown is running. If you don't cancel, we'll alert your contacts and nearby responders.")
              : t('We detected an unusual event. Tap to confirm if you need help.')}
          </Text>
        </FadeIn>

        {/* Timer */}
        <FadeIn from="zoom" delay={140} style={styles.timerArea}>
          <PulseRings color={urgencyColor} size={170} count={2} duration={countdown > 5 ? 1400 : 800} />
          <LinearGradient colors={urgencyGrad} style={styles.timerCircle}>
            <Animated.Text key={countdown} entering={ZoomIn.duration(220)} style={styles.timerCount}>
              {t('{n}', { n: countdown })}
            </Animated.Text>
            <Text style={styles.timerLabel}>{t('SEC')}</Text>
          </LinearGradient>
        </FadeIn>

        <View style={styles.track}>
          <Animated.View style={[styles.trackFill, { backgroundColor: urgencyColor }, barStyle]} />
        </View>

        <Text style={styles.warningLine}>
          {sending
            ? t('Contacting the server and your trusted contacts…')
            : t('Alerting your contacts in {n}s unless cancelled', { n: countdown })}
        </Text>

        {/* Need help */}
        <FadeIn delay={220} style={{ width: '100%' }}>
          <Breathing min={0.98} max={1.02} duration={600}>
            <PressableScale
              onPress={confirmEmergency}
              disabled={sending || failed}
              style={[styles.helpWrapper, shadows.danger, (sending || failed) && { opacity: 0.6 }]}
              accessibilityRole="button"
            >
              <LinearGradient colors={urgencyGrad} style={styles.helpBtn} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
                <AlertTriangle color={colors.onFill} size={22} />
                <Text style={styles.helpText}>{t('I need help now')}</Text>
              </LinearGradient>
            </PressableScale>
          </Breathing>
        </FadeIn>

        {/* I'm okay */}
        <FadeIn delay={280} style={{ width: '100%' }}>
          <PressableScale
            onPress={failed ? dismissFailure : cancelAlert}
            disabled={sending}
            style={[styles.okBtn, sending && { opacity: 0.5 }]}
            accessibilityRole="button"
          >
            {sending ? <Loader color={colors.success} size={22} /> : <CheckCircle color={colors.success} size={22} />}
            <Text style={styles.okText}>{failed ? t('Close') : t("I'm okay — cancel alert")}</Text>
          </PressableScale>
        </FadeIn>
      </View>
    </LinearGradient>
  );
}

const makeStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    root: { flex: 1 },
    content: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl },
    badge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      borderWidth: 1,
      borderRadius: radius.full,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      marginBottom: spacing.lg,
    },
    badgeText: { ...type.label, fontWeight: '800', textTransform: 'uppercase' },
    title: { ...type.hero, color: colors.text, marginBottom: spacing.sm, textAlign: 'center' },
    sub: { ...type.sm, color: colors.textSub, textAlign: 'center', lineHeight: 22, marginBottom: spacing.lg },
    timerArea: { width: 220, height: 220, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md },
    timerCircle: {
      width: 146,
      height: 146,
      borderRadius: 73,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 3,
      borderColor: 'rgba(255,255,255,0.2)',
    },
    timerCount: { fontSize: 58, fontWeight: '800', color: colors.onFill, lineHeight: 64 },
    timerLabel: { ...type.xs, color: colors.onFill, opacity: 0.8, fontWeight: '700', letterSpacing: 2 },
    track: {
      width: '100%',
      height: 6,
      borderRadius: 3,
      backgroundColor: 'rgba(255,255,255,0.1)',
      overflow: 'hidden',
      marginBottom: spacing.sm,
    },
    trackFill: { height: '100%', borderRadius: 3 },
    warningLine: { ...type.sm, color: colors.textSub, textAlign: 'center', marginBottom: spacing.xl },
    helpWrapper: { width: '100%', borderRadius: radius.xl, marginBottom: spacing.md },
    helpBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      paddingVertical: spacing.md + 4,
      borderRadius: radius.xl,
    },
    helpText: { ...type.h3, fontWeight: '800', color: colors.onFill },
    okBtn: {
      width: '100%',
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      paddingVertical: spacing.md + 4,
      borderRadius: radius.xl,
      borderWidth: 1.5,
      borderColor: `${colors.success}66`,
      backgroundColor: `${colors.success}14`,
    },
    okText: { ...type.bodyStrong, color: colors.successText },
  });
