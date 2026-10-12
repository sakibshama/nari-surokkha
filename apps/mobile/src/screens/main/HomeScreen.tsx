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
  AlertTriangle,
  Archive,
  Map as MapIcon,
  Menu,
  Navigation,
  Phone,
  PhoneCall,
  UserRound,
  ShieldAlert,
  Timer,
  Users,
} from 'lucide-react-native';

import { MainStackParamList } from '../../navigation/MainStack';
import { useAuthStore } from '../../store/authStore';
import { useLocationStore } from '../../store/locationStore';
import api, { describeApiTarget, previewBody } from '../../services/api';
import { sensorProcessor } from '../../services/ml/SensorProcessor';
import { softAlerts } from '../../services/emergency/runtime';
import DetectionStatusChip from '../../components/DetectionStatusChip';
import { motionModelLoader } from '../../services/ml/ModelLoader';
import { sendOfflineSosSms, getCachedContactPhones } from '../../services/offlineSos';
import { hasSmsPermission, requestSmsPermission } from '../../services/directSms';
import { logSms } from '../../services/smsHistory';
import { sendSosSmsFromDevice } from '../../services/deviceSms';
import { useTheme } from '../../theme';
import { useT } from '../../i18n';
import { radius, spacing, type as typeScale } from '../../theme/tokens';
import GovStrip from '../../components/GovStrip';
import AmbientBackground from '../../components/AmbientBackground';
import ThemeToggle from '../../components/ThemeToggle';
import LanguageToggle from '../../components/LanguageToggle';
import { FadeIn, PressableScale, PulseRings, Txt } from '../../components/ui';

type Props = NativeStackScreenProps<MainStackParamList, 'Home'>;

type Tint = 'accent' | 'info' | 'success' | 'warning' | 'gov' | 'danger';

type Action = {
  id: string;
  label: string;
  icon: React.ComponentType<{ color: string; size: number }>;
  tint: Tint;
};

/**
 * Shortcuts, ordered by how urgently they get used: the three things you reach
 * for while something is happening, then the everyday ones.
 *
 * Each carries its own colour so the grid reads as nine distinct tools rather
 * than nine identical cards. Only "Call 999" uses the emergency red, and only
 * because it is one.
 */
const ACTIONS: Action[] = [
  { id: 'call999', label: 'Call 999', icon: PhoneCall, tint: 'danger' },
  { id: 'route', label: 'Safe Route', icon: Navigation, tint: 'info' },
  { id: 'fakecall', label: 'Fake Call', icon: Phone, tint: 'warning' },
  { id: 'silent', label: 'Silent Alert', icon: Timer, tint: 'gov' },
  { id: 'contacts', label: 'Contacts', icon: Users, tint: 'accent' },
  { id: 'map', label: 'Safety Map', icon: MapIcon, tint: 'success' },
  { id: 'report', label: 'Report', icon: AlertTriangle, tint: 'warning' },
  { id: 'evidence', label: 'Evidence', icon: Archive, tint: 'accent' },
  { id: 'profile', label: 'Profile', icon: UserRound, tint: 'info' },
];

const SOS_SIZE = 212;

export default function HomeScreen({ navigation }: Props) {
  const { colors, gradients, shadows, isDark } = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const { user, updateUser } = useAuthStore();
  const { isSosActive, setSosActive, activeAlertId } = useLocationStore();
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

    // Motion (fall / struggle) detections go through the same soft-alert
    // manager as the sound detections, so they share its duplicate
    // suppression, cooldown and history. Sound detection itself runs app-wide
    // in <EmergencyRuntime/>, not only while this screen is mounted.
    sensorProcessor.startListening();
    const onSensor = (c: number) => {
      if (c > 0.85) softAlerts.trigger('motion', { confidence: c });
    };
    sensorProcessor.addListener(onSensor);
    return () => {
      sensorProcessor.removeListener(onSensor);
      sensorProcessor.stopListening();
    };
  }, []);

  const handleAction = (id: string) => {
    if (id === 'fakecall') navigation.navigate('FakeCall');
    else if (id === 'contacts') navigation.navigate('TrustedContacts');
    else if (id === 'report') navigation.navigate('ReportIncident');
    else if (id === 'map') navigation.navigate('SafetyMap');
    else if (id === 'route') navigation.navigate('SafeRoute');
    else if (id === 'silent') {
      const r = softAlerts.trigger('manual', { manual: true });
      // Already counting down (or an SOS is live): just show it.
      if (!r.accepted && r.reason === 'active') navigation.navigate('SoftAlert');
      else if (!r.accepted && activeAlertId) navigation.navigate('ActiveSos', { alertId: activeAlertId });
    }
    else if (id === 'evidence') navigation.navigate('EvidenceLibrary');
    else if (id === 'profile') navigation.navigate('ProfileSetup');
    else if (id === 'call999') callEmergency();
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
        // 2xx with an unusable body — do not pretend the SOS is live. Say what
        // actually came back and from where; that is the whole diagnosis.
        if (__DEV__) console.error('[SOS] unexpected response body', res.status, res.data);
        const err: any = new Error(
          `${describeApiTarget()} replied ${res.status} without an alert id: ${previewBody(res.data)}`,
        );
        err.badBody = true;
        throw err;
      }

      setSosActive(true, alertData.id);
      navigation.navigate('ActiveSos', { alertId: alertData.id });

      if (alertData.smsViaDevice) {
        // The plan's SMS quota is used up (or the server could not queue the
        // SMS): text the contacts from this phone's SIM, like the offline
        // fallback. If the phone cannot, the server sends it after all.
        const outcome = await sendSosSmsFromDevice({
          alertId: alertData.id,
          contactPhones: alertData.contactPhones,
          message:
            alertData.deviceSmsMessage ||
            t('EMERGENCY: {name} needs help! Location: {link}', {
              name: userName,
              link: `https://maps.google.com/?q=${coords.latitude},${coords.longitude}`,
            }),
        });
        step('device sms', outcome);
        if (outcome === 'sim') {
          toast(t('SOS sent'), t('SMS limit reached — your contacts were texted from your SIM.'), 'success');
        } else if (outcome === 'composer') {
          toast(t('SOS sent'), t('Tap Send in Messages to text your contacts.'), 'info');
        } else if (outcome === 'server') {
          toast(t('SOS sent'), t('Your contacts and nearby responders are being alerted.'), 'success');
        } else {
          showAlert(t('Contacts not texted'), t('Your alert is live, but the SMS could not be sent. Please call 999.'));
        }
      } else {
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
        toast(t('SOS sent'), t('Your contacts and nearby responders are being alerted.'), 'success');
      }
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

      // A reachable server that answered with something unusable is a
      // configuration problem, not an offline phone — say so instead of
      // quietly dropping into the SMS fallback.
      if (err?.badBody || err?.nonApiResponse) {
        showAlert(t('SOS failed'), err.message);
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

  /** Soft background / strong foreground pair for a shortcut's colour. */
  const tintOf = (tint: Tint) =>
    tint === 'danger'
      ? { fg: colors.dangerText, bg: colors.dangerSoft, solid: colors.danger }
      : tint === 'info'
      ? { fg: colors.infoText, bg: colors.infoSoft, solid: colors.info }
      : tint === 'success'
        ? { fg: colors.successText, bg: colors.successSoft, solid: colors.success }
        : tint === 'warning'
          ? { fg: colors.warningText, bg: colors.warningSoft, solid: colors.warning }
          : tint === 'gov'
            ? { fg: colors.govGreen, bg: colors.govGreenSoft, solid: colors.govGreen }
            : { fg: colors.accentText, bg: colors.accentSoft, solid: colors.accent };

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

        <FadeIn delay={160} style={{ paddingHorizontal: spacing.lg, marginTop: spacing.sm }}>
          <DetectionStatusChip onPress={() => navigation.navigate('EmergencyDetection')} />
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

        {/* ── Shortcuts ────────────────────────────────────────── */}
        <View style={styles.grid}>
          {ACTIONS.map((item, i) => {
            const tone = tintOf(item.tint);
            return (
              <FadeIn key={item.id} delay={320 + i * 40} style={styles.tileWrap}>
                <PressableScale
                  accessibilityRole="button"
                  accessibilityLabel={t(item.label)}
                  onPress={() => handleAction(item.id)}
                  scaleTo={0.94}
                  style={styles.tile}
                >
                  <View style={[styles.tileIcon, { backgroundColor: tone.bg, borderColor: tone.solid + '44' }]}>
                    <item.icon color={tone.fg} size={24} />
                  </View>
                  <Text style={[typeScale.xs, styles.tileLabel, { color: colors.textSub }]} numberOfLines={2}>
                    {t(item.label)}
                  </Text>
                </PressableScale>
              </FadeIn>
            );
          })}
        </View>

        <FadeIn delay={720} style={{ alignItems: 'center', marginTop: spacing.md }}>
          <Txt variant="xs" tone="muted" center>
            নারী সুরক্ষা · {t('National Women Safety Service')}
          </Txt>
        </FadeIn>
      </ScrollView>
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
  sosArea: {
    height: SOS_SIZE + 90,
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
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: spacing.sm,
  },
  tileWrap: { width: '33.33%', paddingHorizontal: 2, paddingVertical: 4 },
  tile: {
    alignItems: 'center',
    paddingVertical: 4,
    gap: 5,
  },
  tileLabel: { fontWeight: '600', textAlign: 'center' },
  tileIcon: {
    width: 58,
    height: 58,
    borderRadius: radius.lg,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
