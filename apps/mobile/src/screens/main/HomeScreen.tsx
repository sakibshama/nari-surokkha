import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Platform,
  ScrollView,
  Image,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { DrawerActions } from '@react-navigation/native';
import { MainStackParamList } from '../../navigation/MainStack';
import { useAuthStore } from '../../store/authStore';
import { useLocationStore } from '../../store/locationStore';
import * as Location from 'expo-location';
import {
  ShieldAlert,
  Users,
  User,
  Map,
  AlertTriangle,
  PhoneCall,
  Bell,
  Menu,
} from 'lucide-react-native';
import api from '../../services/api';
import { sensorProcessor } from '../../services/ml/SensorProcessor';
import { audioProcessor } from '../../services/ml/AudioProcessor';
import { motionModelLoader } from '../../services/ml/ModelLoader';
import NetInfo from '@react-native-community/netinfo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { sendOfflineSosSms, getCachedContactPhones } from '../../services/offlineSos';
import { hasSmsPermission, requestSmsPermission } from '../../services/directSms';
import { logSms } from '../../services/smsHistory';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';

import { useTheme } from '../../theme';
import { radius, spacing, type as typeScale } from '../../theme/tokens';
import FlagRoundel from '../../components/FlagRoundel';

type Props = NativeStackScreenProps<MainStackParamList, 'Home'>;

/**
 * The tiles used to be six different candy colours. That made the grid the
 * busiest thing on a screen whose only job is to make one red circle
 * unmissable. They are one accent now; the SOS is the only saturated object.
 */
const MENU = [
  { id: 'fakecall', label: 'Fake Call', icon: PhoneCall },
  { id: 'contacts', label: 'Contacts', icon: Users },
  { id: 'profile', label: 'Profile', icon: User },
  { id: 'responder', label: 'Responder', icon: ShieldAlert },
  { id: 'report', label: 'Report', icon: AlertTriangle },
  { id: 'map', label: 'Safety Map', icon: Map },
];

export default function HomeScreen({ navigation }: Props) {
  const { colors, gradients, shadows, isDark } = useTheme();
  const { user, updateUser } = useAuthStore();
  const { isSosActive, setSosActive, activeAlertId } = useLocationStore();
  const [loading, setLoading] = useState(false);

  // Fetch fresh profile so the name is always up to date.
  // NOTE: the API nests the profile under `data.profile`.
  useEffect(() => {
    api
      .get('/profile')
      .then((res) => {
        const profile = res.data?.data?.profile;
        if (profile?.fullName) {
          updateUser({
            profile: { fullName: profile.fullName, bloodGroup: profile.bloodGroup },
          });
        }
      })
      .catch(() => {});
  }, []);

  // First-run: ask for SMS permission ONCE so the offline SOS can auto-send
  // an emergency text via the SIM without the user tapping "send".
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

  const pulse1 = useSharedValue(1);
  const pulse1Op = useSharedValue(0.6);
  const pulse2 = useSharedValue(1);
  const pulse2Op = useSharedValue(0.4);

  useEffect(() => {
    pulse1.value = withRepeat(
      withTiming(1.6, { duration: 1800, easing: Easing.out(Easing.quad) }),
      -1,
      false,
    );
    pulse1Op.value = withRepeat(
      withTiming(0, { duration: 1800, easing: Easing.out(Easing.quad) }),
      -1,
      false,
    );
    pulse2.value = withRepeat(
      withTiming(1.6, { duration: 1800, easing: Easing.out(Easing.quad) }),
      -1,
      false,
    );
    pulse2Op.value = withRepeat(
      withTiming(0, { duration: 1800, easing: Easing.out(Easing.quad) }),
      -1,
      false,
    );

    setTimeout(() => {
      pulse2.value = withRepeat(
        withTiming(1.6, { duration: 1800, easing: Easing.out(Easing.quad) }),
        -1,
        false,
      );
    }, 600);

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') Alert.alert('Permission Denied', 'SOS needs location permissions.');
    })();

    // Pull a newer on-device model over-the-air if the server has one.
    motionModelLoader.checkForUpdate();

    sensorProcessor.startListening();
    audioProcessor.startListening();
    const onSensor = (c: number) => {
      if (c > 0.85) navigation.navigate('SoftAlert' as any);
    };
    const onAudio = (c: number, cls: string) => {
      if (c > 0.85 && (cls === 'scream' || cls === 'trigger_word'))
        navigation.navigate('SoftAlert' as any);
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

  const p1Style = useAnimatedStyle(() => ({
    transform: [{ scale: pulse1.value }],
    opacity: pulse1Op.value,
  }));
  const p2Style = useAnimatedStyle(() => ({
    transform: [{ scale: pulse2.value }],
    opacity: pulse2Op.value,
  }));

  const handleMenuAction = (id: string) => {
    if (id === 'fakecall') navigation.navigate('FakeCall' as any);
    else if (id === 'contacts') navigation.navigate('TrustedContacts');
    else if (id === 'profile') navigation.navigate('ProfileSetup');
    else if (id === 'responder') navigation.navigate('ResponderHub');
    else if (id === 'report') navigation.navigate('ReportIncident');
    else if (id === 'map') navigation.navigate('SafetyMap');
    else if (id === 'route') navigation.navigate('SafeRoute' as any);
    else if (id === 'silent') navigation.navigate('SoftAlert' as any, { manual: true });
  };

  const handleSos = async () => {
    if (isSosActive) {
      if (activeAlertId) navigation.navigate('ActiveSos', { alertId: activeAlertId });
      return;
    }
    setLoading(true);
    const userName = user?.profile?.fullName || 'A user';
    try {
      // Real GPS fix on every platform — an SOS must NEVER go out with a
      // default/fallback location (responders would be sent to the wrong place).
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLoading(false);
        Alert.alert(
          'Location Required',
          'Location permission is needed so responders can find you. Please enable it and try again.',
        );
        return;
      }
      let loc = null;
      try {
        loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest });
      } catch {
        loc = await Location.getLastKnownPositionAsync();
      }
      if (!loc) {
        setLoading(false);
        Alert.alert(
          'No GPS Signal',
          'Could not determine your location. Move near a window or open area and try again.',
        );
        return;
      }
      const coords = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };

      // ─── Offline path ────────────────────────────────────────
      if (Platform.OS !== 'web') {
        const netInfo = await NetInfo.fetch();
        if (!netInfo.isConnected) {
          setLoading(false);
          await triggerOfflineSms(coords, userName);
          navigation.navigate('OfflineSos' as any);
          return;
        }
      }

      // ─── Online path ─────────────────────────────────────────
      const res = await api.post('/alerts/sos', {
        latitude: coords.latitude,
        longitude: coords.longitude,
      });
      const alertData = res.data.data;

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
      navigation.navigate('ActiveSos', { alertId: alertData.id });
    } catch (err: any) {
      const msg = err.response?.data?.error?.message;
      if (msg && msg.includes('trusted contact')) {
        Alert.alert('Missing Setup', msg, [
          { text: 'Add Contact', onPress: () => navigation.navigate('TrustedContacts') },
          { text: 'Cancel', style: 'cancel' },
        ]);
      } else if (!err.response) {
        let coords: { latitude: number; longitude: number } | undefined;
        try {
          if (Platform.OS !== 'web') {
            const last = await Location.getLastKnownPositionAsync();
            if (last) coords = { latitude: last.coords.latitude, longitude: last.coords.longitude };
          }
        } catch {
          /* ignore */
        }
        await triggerOfflineSms(coords, userName);
      } else {
        Alert.alert('SOS Failed', 'Could not trigger SOS. Call 999 directly.');
      }
    } finally {
      setLoading(false);
    }
  };

  /** Offline SOS: auto-send SMS via SIM (Android) or open the composer (fallback). */
  const triggerOfflineSms = async (
    coords: { latitude: number; longitude: number } | undefined,
    userName: string,
  ) => {
    const result = await sendOfflineSosSms({ coords, userName });
    if (result.opened && result.auto) {
      Alert.alert(
        'Emergency SMS sent',
        'You are offline — your SOS text went to your trusted contacts over SMS.',
        [
          { text: 'View history', onPress: () => navigation.navigate('SmsHistory') },
          { text: 'OK', style: 'cancel' },
        ],
      );
    } else if (!result.opened) {
      Alert.alert(
        'Offline SOS',
        `${result.reason || 'Could not open Messages.'} Please call 999 directly.`,
      );
    }
  };

  const displayName = user?.profile?.fullName?.trim() || 'there';

  const getGreeting = () => {
    const h = new Date().getHours();
    if (h >= 5 && h < 12) return 'Good morning,';
    if (h >= 12 && h < 17) return 'Good afternoon,';
    if (h >= 17 && h < 21) return 'Good evening,';
    return 'Good night,';
  };

  const statusTone = isSosActive
    ? { bg: colors.dangerSoft, border: colors.danger, dot: colors.danger, fg: colors.dangerText }
    : { bg: colors.successSoft, border: colors.success, dot: colors.success, fg: colors.successText };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} showsVerticalScrollIndicator={false}>
        {/* Government identity strip */}
        <View
          style={[
            styles.govStrip,
            { backgroundColor: colors.govGreenSoft, borderColor: colors.border },
          ]}
        >
          <Image
            source={require('../../../assets/icon.png')}
            style={styles.govStripLogo}
            resizeMode="contain"
          />
          <View style={{ flex: 1 }}>
            <Text style={[typeScale.smStrong, { color: colors.text }]}>
              গণপ্রজাতন্ত্রী বাংলাদেশ সরকার
            </Text>
            <Text
              style={[
                typeScale.xs,
                { color: colors.textMuted, letterSpacing: 0.5, textTransform: 'uppercase' },
              ]}
            >
              National Women Safety Service
            </Text>
          </View>
        </View>

        {/* Header */}
        <View style={styles.topBar}>
          <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open menu"
              onPress={() => navigation.dispatch(DrawerActions.openDrawer())}
              hitSlop={8}
              style={{ marginRight: spacing.md, padding: 4 }}
            >
              <Menu color={colors.text} size={26} />
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text style={[typeScale.sm, { color: colors.textMuted }]}>{getGreeting()}</Text>
              <Text style={[typeScale.h1, { color: colors.text, marginTop: 2 }]} numberOfLines={1}>
                {displayName}
              </Text>
            </View>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Notifications"
            style={[
              styles.notifBtn,
              { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
            ]}
          >
            <Bell color={colors.textSub} size={20} />
          </Pressable>
        </View>

        {/* Status pill */}
        <View
          style={[
            styles.statusBanner,
            { backgroundColor: statusTone.bg, borderColor: statusTone.border },
          ]}
        >
          <View style={[styles.statusDot, { backgroundColor: statusTone.dot }]} />
          <Text style={[typeScale.xs, { color: statusTone.fg, fontWeight: '700' }]}>
            {isSosActive ? 'SOS ACTIVE — broadcasting your location' : 'Protected — monitoring active'}
          </Text>
        </View>

        {/* ── The one loud thing on this screen ───────────────────── */}
        <View style={styles.sosArea}>
          <Animated.View
            style={[styles.pulseRing, p1Style, { borderColor: colors.danger, opacity: 0.5 }]}
          />
          <Animated.View
            style={[styles.pulseRing, p2Style, { borderColor: colors.danger, opacity: 0.3 }]}
          />

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={isSosActive ? 'SOS is active. Open the active alert.' : 'Send SOS'}
            accessibilityHint="Alerts your trusted contacts and the nearest police station"
            onPress={handleSos}
            disabled={loading}
            style={({ pressed }) => [
              styles.sosOuter,
              shadows.danger,
              pressed && { transform: [{ scale: 0.97 }] },
            ]}
          >
            <LinearGradient
              colors={
                isSosActive
                  ? ([colors.dangerPressed, colors.danger] as const)
                  : gradients.danger
              }
              style={[
                styles.sosInner,
                { borderColor: isDark ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.34)' },
              ]}
              start={{ x: 0.15, y: 0 }}
              end={{ x: 0.85, y: 1 }}
            >
              {loading ? (
                <ActivityIndicator size="large" color={colors.onDanger} />
              ) : (
                <>
                  <ShieldAlert color={colors.onDanger} size={48} />
                  <Text style={[styles.sosLabel, { color: colors.onDanger }]}>
                    {isSosActive ? 'ACTIVE' : 'SOS'}
                  </Text>
                  <Text style={[styles.sosSublabel, { color: colors.onDanger }]}>
                    {isSosActive ? 'Help is on the way' : 'Tap in an emergency'}
                  </Text>
                </>
              )}
            </LinearGradient>
          </Pressable>
        </View>

        {/* Quick actions */}
        <View style={styles.menuGrid}>
          {MENU.map((item) => (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              accessibilityLabel={item.label}
              onPress={() => handleMenuAction(item.id)}
              style={({ pressed }) => [
                styles.menuTile,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                },
                shadows.soft,
                pressed && { backgroundColor: colors.surfaceAlt, transform: [{ scale: 0.98 }] },
              ]}
            >
              <View style={[styles.tileIcon, { backgroundColor: colors.accentSoft }]}>
                <item.icon color={colors.accent} size={24} />
              </View>
              <Text
                style={[typeScale.xs, { color: colors.textSub, fontWeight: '600', textAlign: 'center' }]}
              >
                {item.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Government footer */}
        <View style={styles.govFooter}>
          <FlagRoundel size={16} />
          <Text
            style={[
              typeScale.xs,
              { color: colors.textMuted, textAlign: 'center', flexShrink: 1, fontSize: 10.5 },
            ]}
          >
            জাতীয় নারী নিরাপত্তা সেবা · Govt. of the People's Republic of Bangladesh
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const TILE_SIZE = '30%';

/**
 * Layout only — every colour on this screen comes from the palette at render
 * time, so this sheet can stay static.
 */
const styles = StyleSheet.create({
  govStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    marginTop: Platform.OS === 'ios' ? 54 : 42,
    marginHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  govStripLogo: { width: 34, height: 34, borderRadius: 9 },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  notifBtn: {
    width: 42,
    height: 42,
    borderRadius: radius.full,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    borderRadius: radius.full,
    borderWidth: 1,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.sm + 2,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  sosArea: {
    flex: 1,
    minHeight: 320,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.lg,
  },
  pulseRing: { position: 'absolute', width: 280, height: 280, borderRadius: 140, borderWidth: 2 },
  sosOuter: { width: 216, height: 216, borderRadius: 108 },
  sosInner: {
    width: '100%',
    height: '100%',
    borderRadius: 108,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    paddingHorizontal: spacing.md,
  },
  sosLabel: {
    fontSize: 40,
    fontWeight: '800',
    letterSpacing: 3,
    marginTop: 4,
    ...Platform.select({
      web: { textShadow: '0px 2px 6px rgba(0,0,0,0.35)' } as object,
      default: {
        textShadowColor: 'rgba(0,0,0,0.35)',
        textShadowOffset: { width: 0, height: 2 },
        textShadowRadius: 6,
      },
    }),
  },
  sosSublabel: { fontSize: 12.5, fontWeight: '600', marginTop: 2, opacity: 0.9, textAlign: 'center' },
  menuGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-evenly',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xl,
    gap: spacing.sm,
  },
  menuTile: {
    width: TILE_SIZE,
    alignItems: 'center',
    borderRadius: radius.lg,
    borderWidth: 1,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  tileIcon: {
    width: 50,
    height: 50,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  govFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingBottom: spacing.xxl,
    paddingHorizontal: spacing.lg,
  },
});
