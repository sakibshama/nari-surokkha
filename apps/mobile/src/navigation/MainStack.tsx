import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { createNativeStackNavigator, NativeStackNavigationOptions } from '@react-navigation/native-stack';
import { NativeStackHeaderProps } from '@react-navigation/native-stack';
import HomeScreen from '../screens/main/HomeScreen';
import ActiveSosScreen from '../screens/main/ActiveSosScreen';
import TrustedContactsScreen from '../screens/main/TrustedContactsScreen';
import ProfileSetupScreen from '../screens/main/ProfileSetupScreen';
import ResponderHubScreen from '../screens/main/ResponderHubScreen';
import SoftAlertScreen from '../screens/main/SoftAlertScreen';
import ReportIncidentScreen from '../screens/main/ReportIncidentScreen';
import SafetyMapScreen from '../screens/main/SafetyMapScreen';
import FakeCallScreen from '../screens/main/FakeCallScreen';
import OfflineSosScreen from '../screens/main/OfflineSosScreen';
import SafeRouteScreen from '../screens/main/SafeRouteScreen';
import SettingsScreen from '../screens/main/SettingsScreen';
import { ChevronLeft, Menu } from 'lucide-react-native';
import { colors, font, spacing } from '../theme';
import { socketService } from '../services/socket';
import * as Notifications from 'expo-notifications';
import { useNavigation, DrawerActions } from '@react-navigation/native';

export type MainStackParamList = {
  Home: undefined;
  ActiveSos: { alertId: string };
  TrustedContacts: undefined;
  ProfileSetup: undefined;
  ResponderHub: undefined;
  SoftAlert: { manual?: boolean } | undefined;
  ReportIncident: undefined;
  SafetyMap: undefined;
  FakeCall: undefined;
  OfflineSos: undefined;
  SafeRoute: undefined;
  Settings: undefined;
};

// ─── Custom Premium Header ───────────────────────────────────────────────────
function CustomHeader({ navigation, route, options, back }: NativeStackHeaderProps) {
  const title = options.title ?? route.name;
  return (
    <View style={styles.headerContainer}>
      {/* Left: Back button or Menu */}
      <View style={styles.headerSide}>
        {back ? (
          <TouchableOpacity
            onPress={navigation.goBack}
            style={styles.backBtn}
            activeOpacity={0.7}
          >
            <ChevronLeft color={colors.text} size={24} />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            onPress={() => navigation.dispatch(DrawerActions.openDrawer())}
            style={styles.backBtn}
            activeOpacity={0.7}
          >
            <Menu color={colors.text} size={24} />
          </TouchableOpacity>
        )}
      </View>

      {/* Center: Title */}
      <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>

      {/* Right: Placeholder to keep title centered */}
      <View style={styles.headerSide} />
    </View>
  );
}

// ─── Global screen options ────────────────────────────────────────────────────
const globalOptions: NativeStackNavigationOptions = {
  header: (props) => <CustomHeader {...props} />,
};

const Stack = createNativeStackNavigator<MainStackParamList>();

export default function MainStack() {
  const navigation = useNavigation<any>();

  React.useEffect(() => {
    // 1. Connect socket globally for logged-in users
    socketService.connect();

    // 2. Listen for responder dispatches
    const handleDispatch = async (dispatchData: any) => {
      if (Platform.OS === 'web') {
        // --- Web Fallback for Push Notifications ---
        try {
          const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
          if (AudioContextClass) {
            const ctx = new AudioContextClass();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(880, ctx.currentTime);
            osc.frequency.linearRampToValueAtTime(440, ctx.currentTime + 0.3);
            gain.gain.setValueAtTime(0.5, ctx.currentTime);
            gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.5);
            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + 0.5);
          }
        } catch (e) { console.warn('Web Audio beep failed', e); }
        
        const go = window.confirm('🚨 EMERGENCY DISPATCH\n\nA citizen nearby has triggered an SOS! Tap OK to respond.');
        if (go) {
          navigation.navigate('ResponderHub');
        }
      } else {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: '🚨 EMERGENCY DISPATCH',
            body: 'A citizen nearby has triggered an SOS! Tap to respond.',
            sound: true,
            priority: Notifications.AndroidNotificationPriority.MAX,
            data: { screen: 'ResponderHub', dispatchId: dispatchData.id },
          },
          trigger: null, // trigger immediately
        });
      }
    };

    if (socketService.socket) {
      socketService.socket.on('responder:dispatch_received', handleDispatch);
    }

    // 3. Handle notification taps to navigate automatically
    const sub = Notifications.addNotificationResponseReceivedListener(response => {
      const data = response.notification.request.content.data;
      if (data?.screen === 'ResponderHub') {
        navigation.navigate('ResponderHub');
      }
    });

    return () => {
      if (socketService.socket) {
        socketService.socket.off('responder:dispatch_received', handleDispatch);
      }
      sub.remove();
    };
  }, [navigation]);

  return (
    <Stack.Navigator screenOptions={globalOptions}>
      {/* Home manages its own top bar — no nav header */}
      <Stack.Screen
        name="Home"
        component={HomeScreen}
        options={{ headerShown: false }}
      />
      {/* Active SOS — full red screen, no nav header */}
      <Stack.Screen
        name="ActiveSos"
        component={ActiveSosScreen}
        options={{ headerShown: false, gestureEnabled: false }}
      />
      {/* Soft Alert — full-screen modal */}
      <Stack.Screen
        name="SoftAlert"
        component={SoftAlertScreen}
        options={{ headerShown: false, presentation: 'fullScreenModal' }}
      />
      {/* Secondary screens — show custom dark header */}
      <Stack.Screen
        name="TrustedContacts"
        component={TrustedContactsScreen}
        options={{ title: 'Trusted Contacts', headerShown: false }}
      />
      <Stack.Screen
        name="ProfileSetup"
        component={ProfileSetupScreen}
        options={{ title: 'Profile', headerShown: false }}
      />
      <Stack.Screen
        name="ResponderHub"
        component={ResponderHubScreen}
        options={{ title: 'Responder Hub', headerShown: false }}
      />
      <Stack.Screen
        name="ReportIncident"
        component={ReportIncidentScreen}
        options={{ title: 'Report Incident', headerShown: false }}
      />
      <Stack.Screen
        name="SafetyMap"
        component={SafetyMapScreen}
        options={{ title: 'Safety Map', headerShown: false }}
      />
      <Stack.Screen
        name="FakeCall"
        component={FakeCallScreen}
        options={{ title: 'Fake Call', headerShown: false }}
      />
      <Stack.Screen
        name="OfflineSos"
        component={OfflineSosScreen}
        options={{ headerShown: false, gestureEnabled: false }}
      />
      <Stack.Screen
        name="SafeRoute"
        component={SafeRouteScreen}
        options={{ title: 'Safe Route Tracking' }}
      />
      <Stack.Screen 
        name="Settings" 
        component={SettingsScreen}
        options={{ title: 'Settings & Privacy' }}
      />
    </Stack.Navigator>
  );
}

const styles = StyleSheet.create({
  headerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.bg,
    borderBottomWidth: 1,
    borderBottomColor: colors.glassBorder,
    paddingTop: Platform.OS === 'ios' ? 0 : 8,
    paddingBottom: 12,
    paddingHorizontal: spacing.md,
    height: Platform.OS === 'ios' ? 52 : 60,
  },
  headerSide: {
    width: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    ...font.h3,
    color: colors.text,
    flex: 1,
    textAlign: 'center',
    letterSpacing: 0.3,
  },
});
