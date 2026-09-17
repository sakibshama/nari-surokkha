import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { showAlert, toast } from '../../utils/notify';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { DrawerActions } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import NetInfo from '@react-native-community/netinfo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  FadeIn as RFadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import {
  Activity,
  AlertTriangle,
  ChevronRight,
  Map as MapIcon,
  Menu,
  Mic,
  Navigation,
  Phone,
  PhoneCall,
  ShieldAlert,
  ShieldCheck,
  Timer,
  Users,
} from 'lucide-react-native';

import { MainStackParamList } from '../../navigation/MainStack';
import { useAuthStore } from '../../store/authStore';
import { useLocationStore } from '../../store/locationStore';
import { useSettingsStore } from '../../store/settingsStore';
import api from '../../services/api';
import { sensorProcessor } from '../../services/ml/SensorProcessor';
import { audioProcessor } from '../../services/ml/AudioProcessor';
import { motionModelLoader } from '../../services/ml/ModelLoader';
import { sendOfflineSosSms, getCachedContactPhones } from '../../services/offlineSos';
import { hasSmsPermission, requestSmsPermission } from '../../services/directSms';
import { logSms } from '../../services/smsHistory';
import { useTheme } from '../../theme';
import { useT } from '../../i18n';
import { radius, spacing, type as typeScale } from '../../theme/tokens';
import GovStrip from '../../components/GovStrip';
import AmbientBackground from '../../components/AmbientBackground';
import ThemeToggle from '../../components/ThemeToggle';
import LanguageToggle from '../../components/LanguageToggle';
import { Breathing, FadeIn, PressableScale, PulseRings, Txt } from '../../components/ui';

type Props = NativeStackScreenProps<MainStackParamList, 'Home'>;

type Action = {
  id: string;
  label: string;
  hint: string;
  icon: React.ComponentType<{ color: string; size: number }>;
};

/**
 * One accent for every tile: the SOS stays the only saturated object on the
 * screen, which is the whole point of the layout.
 */
const ACTIONS: Action[] = [
  { id: 'contacts', label: 'Contacts', hint: 'Who gets your SOS', icon: Users },
  { id: 'route', label: 'Safe Route', hint: 'Walk with a guardian', icon: Navigation },
  { id: 'fakecall', label: 'Fake Call', hint: 'Excuse yourself safely', icon: PhoneCall },
  { id: 'silent', label: 'Silent Alert', hint: 'Countdown, no sound', icon: Timer },
  { id: 'map', label: 'Safety Map', hint: 'Know the area', icon: MapIcon },
  { id: 'report', label: 'Report', hint: 'Flag an unsafe place', icon: AlertTriangle },
];

const SOS_SIZE = 212;

export default function HomeScreen({ navigation }: Props) {
  const { colors, gradients, shadows, isDark } = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const { user, updateUser } = useAuthStore();
  const { isSosActive, setSosActive, activeAlertId } = useLocationStore();
  const { mlVoiceEnabled, mlGyroEnabled } = useSettingsStore();
  const [loading, setLoading] = useState(false);

  // The SOS button drives its own press animation through a plain Pressable.
  // Everything else uses PressableScale; this is the one control that must
  // never depend on a wrapper component to deliver a tap.
  const sosScale = useSharedValue(1);
  const sosAnim = useAnimatedStyle(() => ({ transform: [{ scale: sosScale.value }] }));

  // Fresh profile so the name is current. The API nests it under data.profile.
  useEffect(() => {
    api
      .get('/profile')
      .then((res) => {
        const profile = res.data?.data?.profile;
        if (profile?.fullName) {
          updateUser({ profile: { fullName: profile.fullName, bloodGroup: profile.bloodGroup } });
        }
      })
      .catch(() => {});
  }, []);

  // Keep the trusted-contact cache warm. The offline SOS reads phone numbers
  // from this cache, and it used to be written only by the Contacts screen —
  // so a user who never opened that screen had no offline fallback at all.
  useEffect(() => {
    api
      .get('/contacts')
      .then((res) => AsyncStorage.setItem('@trusted_contacts', JSON.stringify(res.data?.data ?? [])))
      .catch(() => {});
  }, []);

  // First run: ask for SMS permission once so the offline SOS can auto-send.
  useEffect(() => {
    (async () => {
      try {
        if (await AsyncStorage.getItem('@sms_perm_asked')) return;
        await AsyncStorage.setItem('@sms_perm_asked', '1');
        if (!(await hasSmsPermission())) await requestSmsPermission();
      } catch {
        /* non-blocking */
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        showAlert(t('Permission denied'), t('SOS needs location permission.'));
      }
    })();

    // Pull a newer on-device model over the air if the server has one.
    motionModelLoader.checkForUpdate();

    sensorProcessor.startListening();
    audioProcessor.startListening();
    const onSensor = (c: number) => {
      if (c > 0.85) navigation.navigate('SoftAlert' as any);
    };
    const onAudio = (c: number, cls: string) => {
      if (c > 0.85 && (cls === 'scream' || cls === 'trigger_word')) navigation.navigate('SoftAlert' as any);
    };
    sensorProcessor.addListener(onSensor);
    audioProcessor.addListener(onAudio);
    return () => {
      sensorProcessor.removeListener(onSensor);
      audioProcessor.removeListener(onAudio);
      sensorProcessor.stopListening();
      audioProcessor.stopListening();
    };
  }, []);

  const handleAction = (id: string) => {
    if (id === 'fakecall') navigation.navigate('FakeCall');
    else if (id === 'contacts') navigation.navigate('TrustedContacts');
    else if (id === 'report') navigation.navigate('ReportIncident');
    else if (id === 'map') navigation.navigate('SafetyMap');
    else if (id === 'route') navigation.navigate('SafeRoute');
    else if (id === 'silent') navigation.navigate('SoftAlert', { manual: true });
  };

  const handleSos = async () => {
    // Breadcrumbs: an SOS that does nothing is the worst possible failure, so
    // every stage is logged. `npx expo start` shows these in the terminal.
    const step = (msg: string, extra?: unknown) => {
      if (__DEV__) console.log(`[SOS] ${msg}`, extra ?? '');
    };
    step('pressed', { isSosActive, activeAlertId, loading });

    if (loading) return;

    if (isSosActive) {
      if (activeAlertId) {
        navigation.navigate('ActiveSos', { alertId: activeAlertId });
        return;
      }
      // Marked active with no alert id — a stale flag from a previous run.
      // Clear it rather than silently swallowing the press.
      step('stale active flag cleared');
      setSosActive(false, null);
    }

    setLoading(true);
    const userName = user?.profile?.fullName || 'A user';
    try {
      // A real GPS fix every time — an SOS must never go out with a fallback
      // location, or responders are sent to the wrong place.
      const { status } = await Location.requestForegroundPermissionsAsync();
      step('location permission', status);
      if (status !== 'granted') {
        showAlert(
          t('Location required'),
          t('Location permission is needed so responders can find you. Please enable it and try again.'),
        );
        return;
      }

      let loc: Location.LocationObject | null = null;
      try {
        loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest });
      } catch (e) {
        step('high-accuracy fix failed, falling back to last known', e);
        loc = await Location.getLastKnownPositionAsync();
      }
      if (!loc) {
        showAlert(
          t('No GPS signal'),
          t('Could not determine your location. Move near a window or open area and try again.'),
        );
        return;
      }
      const coords = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
      step('fix', coords);

      // ─── Offline path ────────────────────────────────────────
      if (Platform.OS !== 'web') {
        const netInfo = await NetInfo.fetch();
        step('connectivity', netInfo.isConnected);
        if (!netInfo.isConnected) {
          await triggerOfflineSms(coords, userName);
          navigation.navigate('OfflineSos');
          return;
        }
      }

      // ─── Online path ─────────────────────────────────────────
      step('posting /alerts/sos');
      const res = await api.post('/alerts/sos', {
        latitude: coords.latitude,
        longitude: coords.longitude,
      });
      const alertData = res.data?.data;
      step('server responded', alertData?.id);

      if (!alertData?.id) {
        // 2xx with an unusable body — do not pretend the SOS is live.
        throw new Error('The server did not return an alert id.');
      }

      try {
        const phones = await getCachedContactPhones();
        await logSms({
          channel: 'online-server',
          status: 'sent',
          recipients: phones,
          message:
            'SOS alert dispatched online. Your trusted contacts are being notified by SMS via the server, with a live tracking link.',
        });
      } catch {
        /* history is best-effort */
      }

      setSosActive(true, alertData.id);
      toast(t('SOS sent'), t('Your contacts and nearby responders are being alerted.'), 'success');
      navigation.navigate('ActiveSos', { alertId: alertData.id });
    } catch (err: any) {
      const serverMsg = err?.response?.data?.error?.message || err?.response?.data?.message;
      const status = err?.response?.status;
      step('failed', { status, serverMsg, message: err?.message });
      if (__DEV__) console.error('[SOS] error', err);

      if (serverMsg && serverMsg.includes('trusted contact')) {
        showAlert(t('Missing setup'), serverMsg, [
          { text: t('Cancel'), style: 'cancel' },
          { text: t('Add contact'), onPress: () => navigation.navigate('TrustedContacts') },
        ]);
        return;
      }

      // No response at all → the server is unreachable (offline, wrong API
      // URL, or CORS on web). Fall back to SMS, and say so.
      if (!err?.response) {
        let coords: { latitude: number; longitude: number } | undefined;
        try {
          const last = await Location.getLastKnownPositionAsync();
          if (last) coords = { latitude: last.coords.latitude, longitude: last.coords.longitude };
        } catch {
          /* ignore */
        }
        await triggerOfflineSms(coords, userName);
        navigation.navigate('OfflineSos');
        return;
      }

      showAlert(
        t('SOS failed'),
        serverMsg
          ? `${serverMsg} (${status})`
          : t('Could not trigger SOS. Call 999 directly.'),
      );
    } finally {
      setLoading(false);
    }
  };

  /** Offline SOS: auto-send SMS via the SIM (Android) or open the composer. */
  const triggerOfflineSms = async (
    coords: { latitude: number; longitude: number } | undefined,
    userName: string,
  ) => {
    const result = await sendOfflineSosSms({ coords, userName });
    if (__DEV__) console.log('[SOS] offline sms', result);
    if (result.opened && result.auto) {
      showAlert(t('Emergency SMS sent'), t('You are offline — your SOS text went to your trusted contacts over SMS.'), [
        { text: t('OK'), style: 'cancel' },
        { text: t('View history'), onPress: () => navigation.navigate('SmsHistory') },
      ]);
    } else if (result.opened) {
      showAlert(t('Review & send'), t('Your Messages app opened with the SOS text ready — tap Send to dispatch it.'));
    } else {
      showAlert(
        t('Offline SOS'),
        `${result.reason || t('Could not open Messages.')} ${t('Please call 999 directly.')}`,
      );
    }
  };

  const callEmergency = () => {
    Linking.openURL('tel:999').catch(() => showAlert(t('Call failed'), t('Please dial 999 manually.')));
  };

  const displayName = user?.profile?.fullName?.trim() || t('there');

  const greeting = (() => {
    const h = new Date().getHours();
    if (h >= 5 && h < 12) return t('Good morning');
    if (h >= 12 && h < 17) return t('Good afternoon');
    if (h >= 17 && h < 21) return t('Good evening');
    return t('Good night');
  })();

  const statusTone = isSosActive
    ? { bg: colors.dangerSoft, border: colors.danger, dot: colors.danger, fg: colors.dangerText }
    : { bg: colors.successSoft, border: colors.success, dot: colors.success, fg: colors.successText };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <AmbientBackground />
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + spacing.sm, paddingBottom: insets.bottom + spacing.xl }}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Top bar ───────────────────────────────────────────── */}
        <FadeIn from="up" style={styles.topBar}>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={t('Open menu')}
            onPress={() => navigation.dispatch(DrawerActions.openDrawer())}
            hitSlop={6}
            style={[styles.roundBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <Menu color={colors.text} size={22} />
          </PressableScale>
          <View style={{ flex: 1 }} />
          <LanguageToggle />
          <ThemeToggle />
        </FadeIn>

        {/* ── Greeting ──────────────────────────────────────────── */}
        <FadeIn delay={60} style={{ paddingHorizontal: spacing.lg, marginTop: spacing.md }}>
          <Txt variant="sm" tone="muted">{greeting},</Txt>
          <Txt variant="hero" numberOfLines={1} style={{ marginTop: 2 }}>
            {displayName}
          </Txt>
        </FadeIn>

        <FadeIn delay={110} style={{ paddingHorizontal: spacing.lg, marginTop: spacing.md }}>
          <GovStrip />
        </FadeIn>

        {/* ── Status ────────────────────────────────────────────── */}
        <FadeIn delay={160} style={{ paddingHorizontal: spacing.lg, marginTop: spacing.md }}>
          <View style={[styles.statusCard, { backgroundColor: statusTone.bg, borderColor: statusTone.border }]}>
            <Breathing>
              <View style={[styles.statusDotOuter, { backgroundColor: statusTone.dot + '33' }]}>
                <View style={[styles.statusDot, { backgroundColor: statusTone.dot }]} />
              </View>
            </Breathing>
            <View style={{ flex: 1 }}>
              <Text style={[typeScale.smStrong, { color: statusTone.fg }]}>
                {isSosActive ? t('SOS active — sharing your location') : t('You are protected')}
              </Text>
              <View style={styles.chips}>
                <Chip on={mlVoiceEnabled} icon={Mic} label={t('Voice')} />
                <Chip on={mlGyroEnabled} icon={Activity} label={t('Motion')} />
                <Chip on icon={ShieldCheck} label={t('Contacts')} />
              </View>
            </View>
          </View>
        </FadeIn>

        {/* ── The one loud thing on this screen ─────────────────── */}
        <FadeIn from="zoom" delay={220} style={styles.sosArea}>
          <PulseRings color={colors.danger} size={SOS_SIZE + 40} count={3} duration={isSosActive ? 1500 : 2600} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={isSosActive ? t('SOS is active. Open the active alert.') : t('Send SOS')}
            accessibilityHint={t('Alerts your trusted contacts and nearby volunteer responders')}
            accessibilityState={{ disabled: loading, busy: loading }}
            onPress={handleSos}
            onPressIn={() => {
              sosScale.value = withSpring(0.93, { damping: 18, stiffness: 320 });
            }}
            onPressOut={() => {
              sosScale.value = withSpring(1, { damping: 14, stiffness: 260 });
            }}
            disabled={loading}
            hitSlop={12}
            style={styles.sosOuter}
          >
            <Animated.View style={[styles.sosFill, shadows.danger, sosAnim]}>
              <LinearGradient
                colors={isSosActive ? ([colors.dangerPressed, colors.danger] as const) : gradients.danger}
                style={[
                  styles.sosInner,
                  { borderColor: isDark ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.4)' },
                ]}
                start={{ x: 0.15, y: 0 }}
                end={{ x: 0.85, y: 1 }}
              >
                {loading ? (
                  <ActivityIndicator size="large" color={colors.onDanger} />
                ) : (
                  <Animated.View
                    key={isSosActive ? 'active' : 'idle'}
                    entering={RFadeIn.duration(250)}
                    exiting={FadeOut.duration(150)}
                    style={{ alignItems: 'center' }}
                  >
                    <ShieldAlert color={colors.onDanger} size={44} />
                    <Text style={[styles.sosLabel, { color: colors.onDanger }]}>
                      {isSosActive ? t('ACTIVE') : 'SOS'}
                    </Text>
                    <Text style={[styles.sosSublabel, { color: colors.onDanger }]}>
                      {isSosActive ? t('Help is on the way') : t('Tap in an emergency')}
                    </Text>
                  </Animated.View>
                )}
              </LinearGradient>
            </Animated.View>
          </Pressable>
        </FadeIn>

        {/* ── Emergency call ───────────────────────────────────── */}
        <FadeIn delay={280} style={{ paddingHorizontal: spacing.lg }}>
          <PressableScale
            accessibilityRole="button"
            onPress={callEmergency}
            style={[styles.callRow, { backgroundColor: colors.surface, borderColor: colors.border }, shadows.soft]}
          >
            <View style={[styles.callIcon, { backgroundColor: colors.dangerSoft }]}>
              <Phone size={18} color={colors.dangerText} />
            </View>
            <View style={{ flex: 1 }}>
              <Txt variant="bodyStrong">{t('Call 999')}</Txt>
              <Txt variant="xs" tone="muted">{t('National emergency service')}</Txt>
            </View>
            <ChevronRight size={18} color={colors.textMuted} />
          </PressableScale>
        </FadeIn>

        {/* ── Quick actions ─────────────────────────────────────── */}
        <FadeIn delay={320} style={{ paddingHorizontal: spacing.lg, marginTop: spacing.lg, marginBottom: spacing.sm }}>
          <Txt variant="h3">{t('Quick actions')}</Txt>
        </FadeIn>
        <View style={styles.grid}>
          {ACTIONS.map((item, i) => (
            <FadeIn key={item.id} delay={360 + i * 55} style={styles.tileWrap}>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={t(item.label)}
                onPress={() => handleAction(item.id)}
                style={[styles.tile, { backgroundColor: colors.surface, borderColor: colors.border }, shadows.soft]}
              >
                <View style={[styles.tileIcon, { backgroundColor: colors.accentSoft }]}>
                  <item.icon color={colors.accent} size={22} />
                </View>
                <Txt variant="smStrong" numberOfLines={1}>{t(item.label)}</Txt>
                <Txt variant="xs" tone="muted" numberOfLines={2}>{t(item.hint)}</Txt>
              </PressableScale>
            </FadeIn>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

function Chip({
  on,
  icon: Icon,
  label,
}: {
  on: boolean;
  icon: React.ComponentType<{ color: string; size: number }>;
  label: string;
}) {
  const { colors } = useTheme();
  const fg = on ? colors.successText : colors.textMuted;
  return (
    <View style={[styles.chip, { backgroundColor: on ? colors.surface : colors.surfaceAlt, borderColor: colors.border }]}>
      <Icon color={fg} size={11} />
      <Text style={[typeScale.xs, { color: fg, fontWeight: '600', fontSize: 11 }]}>{label}</Text>
    </View>
  );
}

/** Layout only — every colour comes from the palette at render time. */
const styles = StyleSheet.create({
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  roundBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.md,
  },
  statusDotOuter: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  statusDot: { width: 12, height: 12, borderRadius: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: radius.full,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  sosArea: {
    height: SOS_SIZE + 110,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sosOuter: { width: SOS_SIZE, height: SOS_SIZE, borderRadius: SOS_SIZE / 2 },
  sosFill: { width: '100%', height: '100%', borderRadius: SOS_SIZE / 2 },
  sosInner: {
    width: '100%',
    height: '100%',
    borderRadius: SOS_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    paddingHorizontal: spacing.md,
  },
  sosLabel: {
    fontSize: 42,
    fontWeight: '900',
    letterSpacing: 3,
    marginTop: 2,
    ...Platform.select({
      web: { textShadow: '0px 2px 6px rgba(0,0,0,0.35)' } as object,
      default: {
        textShadowColor: 'rgba(0,0,0,0.3)',
        textShadowOffset: { width: 0, height: 2 },
        textShadowRadius: 6,
      },
    }),
  },
  sosSublabel: { fontSize: 13, fontWeight: '600', marginTop: 2, opacity: 0.92, textAlign: 'center' },
  callRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.md,
  },
  callIcon: { width: 40, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: spacing.lg - 6,
  },
  tileWrap: { width: '50%', padding: 6 },
  tile: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.md,
    gap: 4,
    minHeight: 124,
  },
  tileIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
});
