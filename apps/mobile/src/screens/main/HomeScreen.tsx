import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, Platform, ScrollView } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { DrawerActions } from '@react-navigation/native';
import { MainStackParamList } from '../../navigation/MainStack';
import { useAuthStore } from '../../store/authStore';
import { useLocationStore } from '../../store/locationStore';
import * as Location from 'expo-location';
import { ShieldAlert, Users, User, Map, AlertTriangle, PhoneCall, Bell, Menu } from 'lucide-react-native';
import api from '../../services/api';
import { sensorProcessor } from '../../services/ml/SensorProcessor';
import { audioProcessor } from '../../services/ml/AudioProcessor';
import { motionModelLoader } from '../../services/ml/ModelLoader';
import NetInfo from '@react-native-community/netinfo';
import { sendOfflineSosSms } from '../../services/offlineSos';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, font, spacing, radius, shadows, gradients } from '../../theme';
import Animated, {
  useSharedValue, useAnimatedStyle,
  withRepeat, withTiming, Easing
} from 'react-native-reanimated';

type Props = NativeStackScreenProps<MainStackParamList, 'Home'>;

// ─── Soft feminine palette (rose / lavender / teal) over the gov identity ───
const ROSE   = '#fb7185';
const PINK   = '#f472b6';
const LAVEND = '#c4b5fd';
const TEAL   = '#34d399';
const GOLD   = '#fcd34d';
const SKY    = '#7dd3fc';
const GOV_GREEN = '#00a878';
const FLAG_RED  = '#f42a41';

const MENU = [
  { id: 'fakecall',  label: 'Fake Call',    icon: PhoneCall,     color: ROSE,   bg: 'rgba(251,113,133,0.14)' },
  { id: 'contacts',  label: 'Contacts',     icon: Users,         color: SKY,    bg: 'rgba(125,211,252,0.13)' },
  { id: 'profile',   label: 'Profile',      icon: User,          color: PINK,   bg: 'rgba(244,114,182,0.14)' },
  { id: 'responder', label: 'Responder',    icon: ShieldAlert,   color: TEAL,   bg: 'rgba(52,211,153,0.13)' },
  { id: 'report',    label: 'Report',       icon: AlertTriangle, color: GOLD,   bg: 'rgba(252,211,77,0.13)' },
  { id: 'map',       label: 'Safety Map',   icon: Map,           color: LAVEND, bg: 'rgba(196,181,253,0.14)' },
  // 'Safe Route' and 'Silent Alert' moved to the app drawer (see DrawerNavigator).
];

/** Mini Bangladesh flag roundel — green field, red disc slightly toward the hoist. */
function FlagMini({ size = 30 }: { size?: number }) {
  return (
    <View style={{
      width: size, height: size, borderRadius: size * 0.28,
      backgroundColor: '#006a4e', alignItems: 'center', justifyContent: 'center',
      borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)',
    }}>
      <View style={{
        width: size * 0.46, height: size * 0.46, borderRadius: size * 0.23,
        backgroundColor: FLAG_RED, marginRight: size * 0.08,
      }} />
    </View>
  );
}

export default function HomeScreen({ navigation }: Props) {
  const { user, updateUser } = useAuthStore();
  const { isSosActive, setSosActive, activeAlertId } = useLocationStore();
  const [loading, setLoading] = useState(false);

  // Fetch fresh profile so name is always up to date.
  // NOTE: the API nests the profile under `data.profile`.
  useEffect(() => {
    api.get('/profile').then(res => {
      const profile = res.data?.data?.profile;
      if (profile?.fullName) {
        updateUser({ profile: { fullName: profile.fullName, bloodGroup: profile.bloodGroup } });
      }
    }).catch(() => {});
  }, []);

  const pulse1 = useSharedValue(1);
  const pulse1Op = useSharedValue(0.6);
  const pulse2 = useSharedValue(1);
  const pulse2Op = useSharedValue(0.4);

  useEffect(() => {
    pulse1.value = withRepeat(withTiming(1.6, { duration: 1800, easing: Easing.out(Easing.quad) }), -1, false);
    pulse1Op.value = withRepeat(withTiming(0, { duration: 1800, easing: Easing.out(Easing.quad) }), -1, false);
    pulse2.value = withRepeat(withTiming(1.6, { duration: 1800, easing: Easing.out(Easing.quad) }), -1, false);
    pulse2Op.value = withRepeat(withTiming(0, { duration: 1800, easing: Easing.out(Easing.quad) }), -1, false);

    setTimeout(() => {
      pulse2.value = withRepeat(withTiming(1.6, { duration: 1800, easing: Easing.out(Easing.quad) }), -1, false);
    }, 600);

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') Alert.alert('Permission Denied', 'SOS needs location permissions.');
    })();

    // Pull a newer on-device model over-the-air if the server has one.
    motionModelLoader.checkForUpdate();

    sensorProcessor.startListening();
    audioProcessor.startListening();
    const onSensor = (c: number) => { if (c > 0.85) navigation.navigate('SoftAlert' as any); };
    const onAudio = (c: number, cls: string) => { if (c > 0.85 && (cls === 'scream' || cls === 'trigger_word')) navigation.navigate('SoftAlert' as any); };
    sensorProcessor.addListener(onSensor);
    audioProcessor.addListener(onAudio);
    return () => {
      sensorProcessor.removeListener(onSensor);
      audioProcessor.removeListener(onAudio);
      sensorProcessor.stopListening();
      audioProcessor.stopListening();
    };
  }, []);

  const p1Style = useAnimatedStyle(() => ({ transform: [{ scale: pulse1.value }], opacity: pulse1Op.value }));
  const p2Style = useAnimatedStyle(() => ({ transform: [{ scale: pulse2.value }], opacity: pulse2Op.value }));

  const handleMenuAction = (id: string) => {
    if (id === 'fakecall') {
      navigation.navigate('FakeCall' as any);
    } else if (id === 'contacts') navigation.navigate('TrustedContacts');
    else if (id === 'profile') navigation.navigate('ProfileSetup');
    else if (id === 'responder') navigation.navigate('ResponderHub');
    else if (id === 'report') navigation.navigate('ReportIncident');
    else if (id === 'map') navigation.navigate('SafetyMap');
    else if (id === 'route') navigation.navigate('SafeRoute' as any);
    else if (id === 'silent') navigation.navigate('SoftAlert' as any, { manual: true });
  };

  const handleSos = async () => {
    if (isSosActive) {
      if (activeAlertId) {
        navigation.navigate('ActiveSos', { alertId: activeAlertId });
      }
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
      // No data connection → skip the API entirely and dispatch via the
      // phone's built-in Messages app (cellular SMS needs no internet).
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
      // Server dispatches SMS to trusted contacts via the configured
      // provider (Twilio / BulkSMSBD) plus push where applicable.
      const res = await api.post('/alerts/sos', { latitude: coords.latitude, longitude: coords.longitude });
      const alertData = res.data.data;

      setSosActive(true, alertData.id);
      navigation.navigate('ActiveSos', { alertId: alertData.id });
    } catch (err: any) {
      const msg = err.response?.data?.error?.message;
      if (msg && msg.includes('trusted contact')) {
        Alert.alert('Missing Setup', msg, [
          { text: 'Add Contact', onPress: () => navigation.navigate('TrustedContacts') },
          { text: 'Cancel', style: 'cancel' }
        ]);
      } else if (!err.response) {
        // No server response → likely a network failure mid-request.
        // Fall back to the native SMS composer so the SOS still goes out.
        let coords: { latitude: number; longitude: number } | undefined;
        try {
          if (Platform.OS !== 'web') {
            const last = await Location.getLastKnownPositionAsync();
            if (last) coords = { latitude: last.coords.latitude, longitude: last.coords.longitude };
          }
        } catch { /* ignore */ }
        await triggerOfflineSms(coords, userName);
      } else {
        Alert.alert('SOS Failed', 'Could not trigger SOS. Call 999 directly.');
      }
    } finally { setLoading(false); }
  };

  /** Open the built-in Messages app with location + maps link to contacts. */
  const triggerOfflineSms = async (
    coords: { latitude: number; longitude: number } | undefined,
    userName: string,
  ) => {
    const result = await sendOfflineSosSms({ coords, userName });
    if (!result.opened) {
      Alert.alert(
        'Offline SOS',
        `${result.reason || 'Could not open Messages.'} Please call 999 directly.`,
      );
    }
  };

  const displayName = user?.profile?.fullName?.trim() || 'there';

  const getGreeting = () => {
    const h = new Date().getHours();
    if (h >= 5  && h < 12) return 'Good Morning,';
    if (h >= 12 && h < 17) return 'Good Afternoon,';
    if (h >= 17 && h < 21) return 'Good Evening,';
    return 'Good Night,';
  };

  return (
    <LinearGradient colors={['#0b0916', '#0e1224', '#0c1a2e']} style={styles.root}>
      {/* Ambient glows — soft rose top-right, gov green bottom-left */}
      <View pointerEvents="none" style={styles.glowRose} />
      <View pointerEvents="none" style={styles.glowGreen} />

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Government identity strip */}
        <View style={styles.govStrip}>
          <FlagMini size={22} />
          <View style={{ flex: 1 }}>
            <Text style={styles.govStripBn}>গণপ্রজাতন্ত্রী বাংলাদেশ সরকার</Text>
            <Text style={styles.govStripEn}>National Women Safety Service</Text>
          </View>
        </View>

        {/* Header */}
      <View style={styles.topBar}>
        <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
          <TouchableOpacity onPress={() => navigation.dispatch(DrawerActions.openDrawer())} style={{ marginRight: spacing.md, padding: 4 }}>
            <Menu color={colors.text} size={26} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.greeting}>{getGreeting()}</Text>
            <Text style={styles.userName} numberOfLines={1}>{displayName} 🌸</Text>
          </View>
        </View>
        <TouchableOpacity style={styles.notifBtn}>
          <Bell color={colors.textSub} size={20} />
        </TouchableOpacity>
      </View>

      {/* Status Banner */}
      <View style={[styles.statusBanner, isSosActive ? styles.statusBannerActive : styles.statusBannerSafe]}>
        <View style={[styles.statusDot, { backgroundColor: isSosActive ? FLAG_RED : GOV_GREEN }]} />
        <Text style={[styles.statusText, { color: isSosActive ? ROSE : TEAL }]}>
          {isSosActive ? 'SOS ACTIVE — Broadcasting' : 'You are protected — Monitoring active'}
        </Text>
      </View>

      {/* SOS Button Area */}
      <View style={styles.sosArea}>
        {/* Ripple rings — soft rose */}
        <Animated.View style={[styles.pulseRing, p1Style, { borderColor: 'rgba(251,113,133,0.45)' }]} />
        <Animated.View style={[styles.pulseRing, p2Style, { borderColor: 'rgba(244,114,182,0.28)' }]} />

        <TouchableOpacity onPress={handleSos} disabled={loading} activeOpacity={0.88} style={styles.sosOuter}>
          <LinearGradient
            colors={isSosActive ? (['#9f1239', '#be123c'] as const) : (['#fb7185', '#e11d48', '#be123c'] as const)}
            style={styles.sosInner}
            start={{ x: 0.15, y: 0 }}
            end={{ x: 0.85, y: 1 }}
          >
            {loading
              ? <ActivityIndicator size="large" color="#fff" />
              : <>
                  <ShieldAlert color="#fff" size={50} />
                  <Text style={styles.sosLabel}>{isSosActive ? 'ACTIVE' : 'SOS'}</Text>
                  <Text style={styles.sosSublabel}>{isSosActive ? 'Help is Coming' : 'Tap in Emergency'}</Text>
                </>
            }
          </LinearGradient>
        </TouchableOpacity>
      </View>

      {/* Menu Grid */}
      <View style={styles.menuGrid}>
        {MENU.map((item) => (
          <TouchableOpacity key={item.id} style={styles.menuTile} onPress={() => handleMenuAction(item.id)} activeOpacity={0.7}>
            <View style={[styles.tileIcon, { backgroundColor: item.bg }]}>
              <item.icon color={item.color} size={26} />
            </View>
            <Text style={styles.tileLabel}>{item.label}</Text>
          </TouchableOpacity>
        ))}
        </View>

        {/* Government footer */}
        <View style={styles.govFooter}>
          <FlagMini size={16} />
          <Text style={styles.govFooterText}>জাতীয় নারী নিরাপত্তা সেবা · Govt. of the People's Republic of Bangladesh</Text>
        </View>
      </ScrollView>
    </LinearGradient>
  );
}

const TILE_SIZE = '30%';

const styles = StyleSheet.create({
  root: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  glowRose: {
    position: 'absolute', top: -80, right: -100,
    width: 280, height: 280, borderRadius: 140,
    backgroundColor: 'rgba(244,114,182,0.09)',
  },
  glowGreen: {
    position: 'absolute', bottom: -100, left: -110,
    width: 300, height: 300, borderRadius: 150,
    backgroundColor: 'rgba(0,168,120,0.08)',
  },
  govStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    marginTop: Platform.OS === 'ios' ? 54 : 42,
    marginHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: 'rgba(0,106,78,0.14)',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'rgba(0,168,120,0.25)',
  },
  govStripBn: { color: 'rgba(255,255,255,0.92)', fontSize: 12, fontWeight: '700' },
  govStripEn: { color: 'rgba(255,255,255,0.55)', fontSize: 10, fontWeight: '600', letterSpacing: 0.6, textTransform: 'uppercase' },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  greeting: { ...font.sm, color: colors.textMuted },
  userName: { ...font.h1, color: colors.text, marginTop: 2 },
  notifBtn: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: 'rgba(244,114,182,0.10)',
    borderWidth: 1, borderColor: 'rgba(244,114,182,0.22)',
    alignItems: 'center', justifyContent: 'center',
  },
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    borderRadius: radius.full ?? 999,
    borderWidth: 1,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.sm + 2,
  },
  statusBannerSafe: {
    backgroundColor: 'rgba(0,168,120,0.10)',
    borderColor: 'rgba(0,168,120,0.28)',
  },
  statusBannerActive: {
    backgroundColor: 'rgba(244,42,65,0.10)',
    borderColor: 'rgba(244,42,65,0.30)',
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { ...font.xs, fontWeight: '700', letterSpacing: 0.3 },
  sosArea: {
    flex: 1,
    minHeight: 320,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.lg,
  },
  pulseRing: {
    position: 'absolute',
    width: 280, height: 280, borderRadius: 140,
    borderWidth: 2,
  },
  sosOuter: {
    width: 216, height: 216, borderRadius: 108,
    shadowColor: '#e11d48',
    shadowOpacity: 0.55,
    shadowRadius: 32,
    shadowOffset: { width: 0, height: 8 },
    elevation: 16,
  },
  sosInner: {
    width: '100%', height: '100%',
    borderRadius: 108,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  sosLabel: {
    color: '#fff', fontSize: 42, fontWeight: 'bold',
    letterSpacing: 3, marginTop: 4,
    ...Platform.select({
      web: { textShadow: '0px 2px 6px rgba(0,0,0,0.4)' } as object,
      default: { textShadowColor: 'rgba(0,0,0,0.4)', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 6 },
    }),
  },
  sosSublabel: { color: 'rgba(255,255,255,0.8)', fontSize: 13, fontWeight: '600', marginTop: 2 },
  menuGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-evenly',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xxl,
    gap: spacing.sm,
  },
  menuTile: {
    width: TILE_SIZE,
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.045)',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    paddingVertical: spacing.md + 2,
    paddingHorizontal: spacing.sm,
    ...shadows.card,
  },
  tileIcon: { width: 54, height: 54, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm },
  tileLabel: { ...font.xs, color: colors.textSub, fontWeight: '600', textAlign: 'center' },
  govFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingBottom: spacing.xxl ?? 32,
    paddingHorizontal: spacing.lg,
    opacity: 0.65,
  },
  govFooterText: {
    color: colors.textMuted,
    fontSize: 10.5,
    fontWeight: '600',
    letterSpacing: 0.3,
    textAlign: 'center',
    flexShrink: 1,
  },
});
