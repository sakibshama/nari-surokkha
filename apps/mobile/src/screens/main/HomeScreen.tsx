import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, Platform, ScrollView } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { DrawerActions } from '@react-navigation/native';
import { MainStackParamList } from '../../navigation/MainStack';
import { useAuthStore } from '../../store/authStore';
import { useLocationStore } from '../../store/locationStore';
import * as Location from 'expo-location';
import { ShieldAlert, Users, User, Map, AlertTriangle, PhoneCall, Bell, Navigation, Menu, Timer } from 'lucide-react-native';
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

const MENU = [
  { id: 'fakecall',  label: 'Fake Call',    icon: PhoneCall,     color: colors.primary,  bg: 'rgba(239,68,68,0.15)' },
  { id: 'contacts',  label: 'Contacts',     icon: Users,         color: colors.blue,     bg: 'rgba(59,130,246,0.15)' },
  { id: 'profile',   label: 'Profile',      icon: User,          color: colors.purple,   bg: 'rgba(139,92,246,0.15)' },
  { id: 'responder', label: 'Responder',    icon: ShieldAlert,   color: colors.green,    bg: 'rgba(16,185,129,0.15)' },
  { id: 'report',    label: 'Report',       icon: AlertTriangle, color: colors.amber,    bg: 'rgba(245,158,11,0.15)' },
  { id: 'map',       label: 'Safety Map',   icon: Map,           color: colors.cyan,     bg: 'rgba(6,182,212,0.15)' },
  { id: 'route',     label: 'Safe Route',   icon: Navigation,    color: colors.purple,   bg: 'rgba(139,92,246,0.15)' },
  { id: 'silent',    label: 'Silent Alert', icon: Timer,         color: colors.pink,     bg: 'rgba(236,72,153,0.15)' },
];

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
    <LinearGradient colors={['#060d1f', '#0a1428', '#0d1b35']} style={styles.root}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Status Bar Space + Header */}
      <View style={styles.topBar}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TouchableOpacity onPress={() => navigation.dispatch(DrawerActions.openDrawer())} style={{ marginRight: spacing.md, padding: 4 }}>
            <Menu color={colors.text} size={28} />
          </TouchableOpacity>
          <View>
            <Text style={styles.greeting}>{getGreeting()}</Text>
            <Text style={styles.userName}>{displayName} 👋</Text>
          </View>
        </View>
        <TouchableOpacity style={styles.notifBtn}>
          <Bell color={colors.textSub} size={22} />
        </TouchableOpacity>
      </View>

      {/* Status Banner */}
      <View style={styles.statusBanner}>
        <View style={[styles.statusDot, { backgroundColor: isSosActive ? colors.primary : colors.green }]} />
        <Text style={styles.statusText}>{isSosActive ? 'SOS ACTIVE — Broadcasting' : 'All Safe — Monitoring Active'}</Text>
      </View>

      {/* SOS Button Area */}
      <View style={styles.sosArea}>
        {/* Ripple rings */}
        <Animated.View style={[styles.pulseRing, p1Style, { borderColor: 'rgba(239,68,68,0.5)' }]} />
        <Animated.View style={[styles.pulseRing, p2Style, { borderColor: 'rgba(239,68,68,0.3)' }]} />

        <TouchableOpacity onPress={handleSos} disabled={loading} activeOpacity={0.88} style={styles.sosOuter}>
          <LinearGradient
            colors={isSosActive ? (['#7f1d1d', '#991b1b'] as const) : gradients.primary}
            style={styles.sosInner}
            start={{ x: 0.2, y: 0 }}
            end={{ x: 0.8, y: 1 }}
          >
            {loading
              ? <ActivityIndicator size="large" color="#fff" />
              : <>
                  <ShieldAlert color="#fff" size={52} />
                  <Text style={styles.sosLabel}>{isSosActive ? 'ACTIVE' : 'SOS'}</Text>
                  <Text style={styles.sosSublabel}>{isSosActive ? 'Help is Coming' : 'Hold in Emergency'}</Text>
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
      </ScrollView>
    </LinearGradient>
  );
}

const TILE_SIZE = '30%';

const styles = StyleSheet.create({
  root: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: spacing.lg,
    paddingTop: Platform.OS === 'ios' ? 60 : 48,
    paddingBottom: spacing.md,
  },
  greeting: { ...font.sm, color: colors.textMuted },
  userName: { ...font.h1, color: colors.text, marginTop: 2 },
  notifBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: colors.bgCard,
    borderWidth: 1, borderColor: colors.glassBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { ...font.xs, color: colors.textSub, fontWeight: '600', letterSpacing: 0.3 },
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
    width: 220, height: 220, borderRadius: 110,
    ...shadows.primary,
  },
  sosInner: {
    width: '100%', height: '100%',
    borderRadius: 110,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.18)',
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
    backgroundColor: colors.bgCard,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    ...shadows.card,
  },
  tileIcon: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm },
  tileLabel: { ...font.xs, color: colors.textSub, fontWeight: '600', textAlign: 'center' },
});
