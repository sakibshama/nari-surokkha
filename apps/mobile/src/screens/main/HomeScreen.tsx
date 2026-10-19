import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import { DrawerActions, useFocusEffect } from '@react-navigation/native';
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
  Newspaper,
  UserRound,
  ShieldAlert,
  Timer,
  Users,
} from 'lucide-react-native';

import { MainStackParamList } from '../../navigation/MainStack';
import { useAuthStore } from '../../store/authStore';
import { useLocationStore } from '../../store/locationStore';
import { useSettingsStore } from '../../store/settingsStore';
import api, { describeApiTarget, previewBody } from '../../services/api';
import { sensorProcessor } from '../../services/ml/SensorProcessor';
import { softAlerts } from '../../services/emergency/runtime';
import DetectionStatusChip from '../../components/DetectionStatusChip';
import { motionModelLoader } from '../../services/ml/ModelLoader';
import { sendOfflineSosSms, getCachedContactPhones } from '../../services/offlineSos';
import { logSms } from '../../services/smsHistory';
import { sendSosSmsFromDevice } from '../../services/deviceSms';
import { ensureSmsPermission, useSmsPermission } from '../../services/smsPermission';
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
 * than nine identical cards.
 */
const ACTIONS: Action[] = [
  { id: 'news', label: 'News Feed', icon: Newspaper, tint: 'gov' },
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
/** A warm or last-known fix younger than this is used as-is. */
const FRESH_FIX_MS = 60_000;
/** With no recent fix, how long the SOS waits for a new one. */
const GPS_TIMEOUT_MS = 4000;
/** The SOS request: past this, a dead connection falls back to SMS. */
const SOS_REQUEST_TIMEOUT_MS = 10_000;

type Fix = { latitude: number; longitude: number; accuracy: number | null };

function toFix(loc: Location.LocationObject | null): Fix | null {
  return loc ? { latitude: loc.coords.latitude, longitude: loc.coords.longitude, accuracy: loc.coords.accuracy ?? null } : null;
}

/**
 * The best position available within a few seconds: a recent warm fix, a
 * recent last-known one, a quick new fix, or any last-known position.
 */
async function quickFix(warm: Location.LocationObject | null): Promise<Fix | null> {
  const now = Date.now();
  if (warm && now - warm.timestamp < FRESH_FIX_MS) return toFix(warm);
  const last = await withTimeout(Location.getLastKnownPositionAsync({ maxAge: FRESH_FIX_MS }), 1000);
  if (last) return toFix(last);
  const fresh = await withTimeout(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }), GPS_TIMEOUT_MS);
  if (fresh) return toFix(fresh);
  return toFix(warm ?? (await withTimeout(Location.getLastKnownPositionAsync(), 1000)));
}

/** Random id for one SOS press (idempotency key; not a secret). */
function newClientSosId(): string {
  const hex = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  return `${Date.now().toString(16)}-${hex()}${hex()}-${hex()}${hex()}`;
}
/**
 * A permission dialog that never answers (another request already holding the
 * system dialog, an activity recreated underneath it) must not freeze the SOS
 * button: after this long the SOS carries on without the permission.
 */
const PERMISSION_TIMEOUT_MS = 20000;

/** Resolve to null instead of hanging or throwing. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    p.catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

export default function HomeScreen({ navigation }: Props) {
  const { colors, gradients, shadows, isDark } = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const { user, updateUser } = useAuthStore();
  const { isSosActive, setSosActive, activeAlertId } = useLocationStore();
  const mlGyroEnabled = useSettingsStore((st) => st.mlGyroEnabled);
  const [loading, setLoading] = useState(false);
  const smsState = useSmsPermission((st) => st.state);

  // Keep a warm GPS fix while Home is on screen, so pressing SOS never waits
  // for the GPS to start. Balanced accuracy, only on movement: cheap.
  const warmFix = useRef<Location.LocationObject | null>(null);
  useFocusEffect(
    useCallback(() => {
      let sub: Location.LocationSubscription | null = null;
      let cancelled = false;
      void (async () => {
        const perm = await Location.getForegroundPermissionsAsync().catch(() => null);
        if (cancelled || perm?.status !== 'granted') return;
        sub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Balanced, timeInterval: 15000, distanceInterval: 25 },
          (loc) => {
            warmFix.current = loc;
          },
        ).catch(() => null);
        if (cancelled) sub?.remove();
      })();
      return () => {
        cancelled = true;
        sub?.remove();
      };
    }, []),
  );

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

  // Permissions (location, SMS, microphone, notifications, camera) are asked
  // once at app start — see services/startupPermissions.ts.
  useEffect(() => {
    // Pull a newer on-device model over the air if the server has one.
    motionModelLoader.checkForUpdate();
  }, []);

  // Motion (fall / struggle) detections go through the same soft-alert
  // manager as the sound detections. The sensors run only while the
  // "Fall & struggle detection" switch is on. Sound detection runs app-wide in
  // <EmergencyRuntime/>, not only while this screen is mounted.
  useEffect(() => {
    if (!mlGyroEnabled) return;
    void sensorProcessor.startListening();
    const onSensor = (c: number) => {
      if (c > 0.85) softAlerts.trigger('motion', { confidence: c });
    };
    sensorProcessor.addListener(onSensor);
    return () => {
      sensorProcessor.removeListener(onSensor);
      sensorProcessor.stopListening();
    };
  }, [mlGyroEnabled]);

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
    else if (id === 'news') navigation.navigate('NewsFeed');
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
    const userName = user?.profile?.fullName?.trim() || '';
    let locationDenied = false;
    // One id per SOS press: lets the server recognise a retry (or the
    // automatic online SOS after an offline SMS) instead of creating a second
    // alert and texting everyone again.
    const clientSosId = newClientSosId();
    try {
      // Speed matters more than a perfect first fix: the alert goes out with
      // the best position available NOW (the warm fix kept while this screen
      // is open, or Android's last known one), and live tracking refines it
      // within seconds. Location permission and connectivity are checked in
      // parallel. No permission never stops an SOS: it goes out by SMS
      // without coordinates and the user is told how to fix it.
      const [perm, netInfo] = await Promise.all([
        Location.getForegroundPermissionsAsync().catch(() => null),
        Platform.OS === 'web' ? Promise.resolve(null) : withTimeout(NetInfo.fetch(), 1500),
      ]);
      const status =
        perm?.status === 'granted'
          ? 'granted'
          : (await withTimeout(Location.requestForegroundPermissionsAsync(), PERMISSION_TIMEOUT_MS))?.status ??
            'denied';
      locationDenied = status !== 'granted';
      const coords = locationDenied ? null : await quickFix(warmFix.current);
      step('location', { status, coords: !!coords });

      // ─── Offline path (or no position: the API needs one) ───
      const offline = netInfo?.isConnected === false || netInfo?.isInternetReachable === false;
      step('connectivity', { offline });
      if (offline || !coords) {
        if (!coords) toast(t('No GPS signal'), t('Sending your SOS by SMS without a location.'), 'info');
        await triggerOfflineSms(coords ?? undefined, userName, clientSosId);
        navigation.navigate('OfflineSos');
        if (locationDenied) promptLocationSettings();
        return;
      }

      // ─── Online path ─────────────────────────────────────────
      step('posting /alerts/sos');
      const res = await api.post(
        '/alerts/sos',
        { latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy ?? undefined, clientSosId },
        // A dead connection must fall back to SMS fast, not after 20 s.
        { timeout: SOS_REQUEST_TIMEOUT_MS },
      );
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
          message: alertData.deviceSmsMessage || '',
          userName,
          coords,
        });
        step('device sms', outcome);
        if (outcome === 'sim') {
          toast(t('SOS sent'), t('SMS limit reached — your contacts were texted from your SIM.'), 'success');
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
        const fix = warmFix.current ?? (await withTimeout(Location.getLastKnownPositionAsync(), 1500));
        const coords = fix ? { latitude: fix.coords.latitude, longitude: fix.coords.longitude } : undefined;
        await triggerOfflineSms(coords, userName, clientSosId);
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

  /** After an SOS sent without a location: show how to switch location on. */
  const promptLocationSettings = () => {
    showAlert(
      t('Turn on location'),
      t('Your SOS was sent by SMS without your location. Allow location so responders can find you next time.'),
      [
        { text: t('Later'), style: 'cancel' },
        { text: t('Open settings'), onPress: () => void Linking.openSettings() },
      ],
    );
  };

  /** Offline SOS: one silent SMS per contact from the SIM (never the Messages composer). */
  const triggerOfflineSms = async (
    coords: { latitude: number; longitude: number } | undefined,
    userName: string,
    clientSosId: string,
  ) => {
    const result = await sendOfflineSosSms({ coords, userName, clientSosId });
    if (__DEV__) console.log('[SOS] offline sms', result);
    if (result.opened) {
      toast(t('Emergency SMS sent'), t('You are offline — your SOS text went to your trusted contacts over SMS.'), 'success');
    } else {
      showAlert(t('Offline SOS'), result.reason || t('The SMS could not be sent from this phone.'), [
        { text: t('OK'), style: 'cancel' },
        { text: t('View history'), onPress: () => navigation.navigate('SmsHistory') },
      ]);
    }
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

        {isSosActive && activeAlertId && (
          <FadeIn style={{ paddingHorizontal: spacing.lg, marginTop: spacing.sm }}>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={t('Return to SOS')}
              onPress={() => navigation.navigate('ActiveSos', { alertId: activeAlertId })}
              style={[styles.sosBanner, { backgroundColor: colors.danger }]}
            >
              <ShieldAlert color={colors.onDanger} size={20} />
              <View style={{ flex: 1 }}>
                <Text style={[typeScale.smStrong, { color: colors.onDanger }]}>{t('SOS is active')}</Text>
                <Text style={[typeScale.xs, { color: colors.onDanger, opacity: 0.9 }]}>
                  {t('Your location is being shared. Tap to return to the SOS.')}
                </Text>
              </View>
              <Text style={[typeScale.smStrong, { color: colors.onDanger }]}>{t('Return to SOS')}</Text>
            </PressableScale>
          </FadeIn>
        )}

        {Platform.OS === 'android' && (smsState === 'restricted' || smsState === 'blocked' || smsState === 'askable') && (
          <FadeIn style={{ paddingHorizontal: spacing.lg, marginTop: spacing.sm }}>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={t('Emergency SMS is off. Tap to turn it on.')}
              onPress={() => void ensureSmsPermission(true)}
              style={[styles.sosBanner, { backgroundColor: colors.warningSoft }]}
            >
              <ShieldAlert color={colors.warningText} size={20} />
              <View style={{ flex: 1 }}>
                <Text style={[typeScale.smStrong, { color: colors.warningText }]}>{t('Emergency SMS is off')}</Text>
                <Text style={[typeScale.xs, { color: colors.warningText }]}>
                  {t('Without internet your SOS cannot text your contacts. Tap to turn it on.')}
                </Text>
              </View>
            </PressableScale>
          </FadeIn>
        )}

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
  sosBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
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
