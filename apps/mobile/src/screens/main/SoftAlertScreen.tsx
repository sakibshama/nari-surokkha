import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Alert as RNAlert, Platform, Vibration } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { MainStackParamList } from '../../navigation/MainStack';
import api from '../../services/api';
import * as Location from 'expo-location';
import * as SMS from 'expo-sms';
import { useAuthStore } from '../../store/authStore';
import { uploadMotionSample, uploadConfirmedEmergencySample } from '../../services/ml/motionSampleUploader';
import { LinearGradient } from 'expo-linear-gradient';
import { Theme, useTheme, useThemedStyles } from '../../theme';
import { radius, spacing, type } from '../../theme/tokens';
import Animated, { ZoomIn, useAnimatedStyle, useSharedValue, withTiming, Easing } from 'react-native-reanimated';
import { Breathing, FadeIn, PressableScale, PulseRings } from '../../components/ui';
import { useT } from '../../i18n';
import { AlertTriangle, CheckCircle } from 'lucide-react-native';

type NavigationProp = NativeStackNavigationProp<MainStackParamList>;

export default function SoftAlertScreen() {
    // Pinned dark: same alarm register as the active-SOS screen.
  const styles = useThemedStyles(makeStyles, 'dark');
  const { colors, gradients, shadows } = useTheme('dark');
  void shadows;
  const t = useT();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<RouteProp<MainStackParamList, 'SoftAlert'>>();
  const manual = route.params?.manual ?? false;
  const { user } = useAuthStore();
  const [countdown, setCountdown] = useState(15);
  const [alertId, setAlertId] = useState<string | null>(null);

  const TOTAL = 15;
  const progress = useSharedValue(1);

  useEffect(() => {
    progress.value = withTiming(0, { duration: TOTAL * 1000, easing: Easing.linear });

    // Vibrate urgently to alert the user (pattern: vibrate 500ms, pause 300ms, repeat)
    if (Platform.OS !== 'web') {
      Vibration.vibrate([0, 500, 300, 500, 300, 500], true);
    }

    createBackendAlert();

    return () => {
      Vibration.cancel();
    };
  }, []);

  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(c => c - 1), 1000);
      return () => clearTimeout(timer);
    } else confirmEmergency();
  }, [countdown]);

  const barStyle = useAnimatedStyle(() => ({ width: `${progress.value * 100}%` }));

  const createBackendAlert = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const loc = await Location.getCurrentPositionAsync({});
      const res = await api.post('/alerts/soft', { latitude: loc.coords.latitude, longitude: loc.coords.longitude, accuracy: loc.coords.accuracy });
      setAlertId(res.data.data.id);
    } catch (e) { console.error(e); }
  };

  const cancelAlert = async () => {
    Vibration.cancel();
    // False alarm → capture this window as a "normal" negative training sample.
    void uploadMotionSample('normal', 'false_alarm');
    if (alertId) { try { await api.patch(`/alerts/${alertId}/soft/cancel`); } catch { /* ignore */ } }
    navigation.goBack();
  };

  const confirmEmergency = async () => {
    Vibration.cancel();
    // Confirmed emergency → capture this window as a positive training sample.
    void uploadConfirmedEmergencySample();
    if (!alertId) return;
    try {
      const res = await api.patch(`/alerts/${alertId}/soft/confirm`);
      const alertData = res.data.data;
      
      navigation.replace('ActiveSos', { alertId });

      if (alertData?.contactPhones && alertData.contactPhones.length > 0) {
        const isAvailable = await SMS.isAvailableAsync();
        if (isAvailable) {
          const name = user?.profile?.fullName || t('A user');
          const link = alertData.trackingToken ? `https://narisurokkha.app/track?token=${alertData.trackingToken}` : '';
          const message = t('EMERGENCY: {name} has triggered an SOS! Track live location here: {link}', { name, link });
          
          setTimeout(async () => {
             try {
               await SMS.sendSMSAsync(alertData.contactPhones, message);
             } catch (smsErr) {
               if (__DEV__) console.error('Failed to open SMS composer', smsErr);
             }
          }, 500);
        }
      }
    } catch {
      RNAlert.alert(t('Error'), t('Connection failed. Check your network.'));
      navigation.goBack();
    }
  };

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
            {manual ? t('Silent alert armed') : t('Fall / danger detected')}
          </Text>
        </FadeIn>

        <FadeIn delay={80} style={{ alignItems: 'center' }}>
          <Text style={styles.title}>{manual ? t('Stay safe') : t('Are you okay?')}</Text>
          <Text style={styles.sub}>
            {manual
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
          {t('Alerting your contacts in {n}s unless cancelled', { n: countdown })}
        </Text>

        {/* Need help */}
        <FadeIn delay={220} style={{ width: '100%' }}>
          <Breathing min={0.98} max={1.02} duration={600}>
            <PressableScale onPress={confirmEmergency} style={[styles.helpWrapper, shadows.danger]} accessibilityRole="button">
              <LinearGradient colors={urgencyGrad} style={styles.helpBtn} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
                <AlertTriangle color={colors.onFill} size={22} />
                <Text style={styles.helpText}>{t('I need help now')}</Text>
              </LinearGradient>
            </PressableScale>
          </Breathing>
        </FadeIn>

        {/* I'm okay */}
        <FadeIn delay={280} style={{ width: '100%' }}>
          <PressableScale onPress={cancelAlert} style={styles.okBtn} accessibilityRole="button">
            <CheckCircle color={colors.success} size={22} />
            <Text style={styles.okText}>{t("I'm okay — cancel alert")}</Text>
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
