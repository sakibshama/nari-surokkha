import React from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ThemeToggle from '../components/ThemeToggle';
import LanguageToggle from '../components/LanguageToggle';
import { PressableScale } from '../components/ui/motion';
import { useT, tStatic } from '../i18n';
import { createNativeStackNavigator, NativeStackNavigationOptions } from '@react-navigation/native-stack';
import { NativeStackHeaderProps } from '@react-navigation/native-stack';
import HomeScreen from '../screens/main/HomeScreen';
import ActiveSosScreen from '../screens/main/ActiveSosScreen';
import TrustedContactsScreen from '../screens/main/TrustedContactsScreen';
import ProfileSetupScreen from '../screens/main/ProfileSetupScreen';
import ResponderHubScreen from '../screens/main/ResponderHubScreen';
import SoftAlertScreen from '../screens/main/SoftAlertScreen';
import SmsHistoryScreen from '../screens/main/SmsHistoryScreen';
import EvidenceLibraryScreen from '../screens/main/EvidenceLibraryScreen';
import ReportIncidentScreen from '../screens/main/ReportIncidentScreen';
import SafetyMapScreen from '../screens/main/SafetyMapScreen';
import FakeCallScreen from '../screens/main/FakeCallScreen';
import OfflineSosScreen from '../screens/main/OfflineSosScreen';
import SafeRouteScreen from '../screens/main/SafeRouteScreen';
import SettingsScreen from '../screens/main/SettingsScreen';
import ChangePasswordScreen from '../screens/main/ChangePasswordScreen';
import SubscriptionScreen from '../screens/main/SubscriptionScreen';
import EmergencyDetectionScreen from '../screens/main/EmergencyDetectionScreen';
import AlertHistoryScreen from '../screens/main/AlertHistoryScreen';
import AboutScreen from '../screens/main/AboutScreen';
import NewsFeedScreen from '../screens/main/NewsFeedScreen';
import { ChevronLeft, Menu } from 'lucide-react-native';
import { Theme, useTheme, useThemedStyles } from '../theme';
import { radius, spacing, type } from '../theme/tokens';
import { socketService } from '../services/socket';
import { isOwnSos } from '../services/responderDispatch';
import { useAuthStore } from '../store/authStore';
import { useLocationStore } from '../store/locationStore';
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
  SmsHistory: undefined;
  EvidenceLibrary: undefined;
  Settings: undefined;
  ChangePassword: undefined;
  Subscription: { trx?: string } | undefined;
  EmergencyDetection: undefined;
  AlertHistory: undefined;
  About: undefined;
  NewsFeed: undefined;
};

// ─── Header ──────────────────────────────────────────────────────────────────
function CustomHeader({ navigation, route, options, back }: NativeStackHeaderProps) {
  // Its own hooks: this is a sibling of MainStack, not nested inside it.
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const title = t(options.title ?? route.name);
  return (
    <View style={[styles.headerContainer, { paddingTop: insets.top + 6 }]}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={back ? t('Go back') : t('Open menu')}
        onPress={back ? navigation.goBack : () => navigation.dispatch(DrawerActions.openDrawer())}
        style={styles.iconBtn}
        hitSlop={6}
      >
        {back ? <ChevronLeft color={colors.text} size={22} /> : <Menu color={colors.text} size={22} />}
      </PressableScale>

      {/* Each screen shows its own large animated title, so the bar stays clean. */}
      <View style={{ flex: 1 }} accessibilityRole="header" accessibilityLabel={title} />

      <View style={styles.headerRight}>
        <LanguageToggle />
        <ThemeToggle size={38} />
      </View>
    </View>
  );
}

// ─── Global screen options ────────────────────────────────────────────────────
const globalOptions: NativeStackNavigationOptions = {
  header: (props) => <CustomHeader {...props} />,
  animation: 'slide_from_right',
};

const Stack = createNativeStackNavigator<MainStackParamList>();

export default function MainStack() {
  const navigation = useNavigation<any>();

  React.useEffect(() => {
    // 1. Connect socket globally for logged-in users
    socketService.connect();

    // 2. Listen for responder dispatches
    const handleDispatch = async (dispatchData: any) => {
      // Never ask a user to help with their OWN SOS (the server excludes the
      // owner; this guards stale events and older servers).
      if (
        isOwnSos(dispatchData, {
          userId: useAuthStore.getState().user?.id,
          activeAlertId: useLocationStore.getState().isSosActive ? useLocationStore.getState().activeAlertId : null,
        })
      ) {
        return;
      }
      try {
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
          
          const go = window.confirm(`🚨 ${tStatic('EMERGENCY DISPATCH')}\n\n${tStatic('A citizen nearby has triggered an SOS! Tap OK to respond.')}`);
          if (go) {
            navigation.navigate('ResponderHub');
          }
        } else {
          await Notifications.scheduleNotificationAsync({
            content: {
              title: `🚨 ${tStatic('EMERGENCY DISPATCH')}`,
              body: tStatic('A citizen nearby has triggered an SOS! Tap to respond.'),
              sound: true,
              priority: Notifications.AndroidNotificationPriority.MAX,
              data: {
                type: 'responder_dispatch',
                screen: 'ResponderHub',
                dispatchId: dispatchData?.dispatchId,
                alertId: dispatchData?.alertId,
                alertUserId: dispatchData?.alertUserId,
              },
            },
            trigger: null, // trigger immediately
          });
        }
      } catch (e) {
        // A local notification that cannot be shown must not become an
        // unhandled rejection; the hub still lists the dispatch.
        if (__DEV__) console.warn('[Dispatch] could not show the dispatch notification', e);
      }
    };

    // Persistent registration — survives the async socket connect + reconnects
    // so a responder reliably receives dispatches while the app is open.
    socketService.on('responder:dispatch_received', handleDispatch);

    // 3. Handle notification taps to navigate automatically
    const sub = Notifications.addNotificationResponseReceivedListener(response => {
      const data = response.notification.request.content.data as any;
      if (data?.screen === 'ResponderHub') {
        navigation.navigate('ResponderHub');
      }
    });

    return () => {
      socketService.off('responder:dispatch_received', handleDispatch);
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
        options={{ headerShown: false, gestureEnabled: false, animation: 'fade' }}
      />
      {/* Soft Alert — full-screen modal */}
      <Stack.Screen
        name="SoftAlert"
        component={SoftAlertScreen}
        options={{ headerShown: false, presentation: 'fullScreenModal', animation: 'fade_from_bottom' }}
      />
      {/* Secondary screens share the themed header (back + language + theme). */}
      <Stack.Screen
        name="TrustedContacts"
        component={TrustedContactsScreen}
        options={{ title: 'Trusted Contacts' }}
      />
      <Stack.Screen
        name="ProfileSetup"
        component={ProfileSetupScreen}
        options={{ title: 'Profile' }}
      />
      <Stack.Screen
        name="ResponderHub"
        component={ResponderHubScreen}
        options={{ title: 'Responder Hub' }}
      />
      <Stack.Screen
        name="ReportIncident"
        component={ReportIncidentScreen}
        options={{ title: 'Report Incident' }}
      />
      <Stack.Screen
        name="SafetyMap"
        component={SafetyMapScreen}
        options={{ title: 'Safety Map' }}
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
        options={{ title: 'Safe Route' }}
      />
      <Stack.Screen
        name="SmsHistory"
        component={SmsHistoryScreen}
        options={{ title: 'SOS SMS History' }}
      />
      <Stack.Screen
        name="EvidenceLibrary"
        component={EvidenceLibraryScreen}
        options={{ title: 'Evidence Library' }}
      />
      <Stack.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ title: 'Settings' }}
      />
      <Stack.Screen
        name="ChangePassword"
        component={ChangePasswordScreen}
        options={{ title: 'Change password' }}
      />
      <Stack.Screen
        name="Subscription"
        component={SubscriptionScreen}
        options={{ title: 'Subscription' }}
      />
      <Stack.Screen
        name="EmergencyDetection"
        component={EmergencyDetectionScreen}
        options={{ title: 'Emergency Detection' }}
      />
      <Stack.Screen
        name="AlertHistory"
        component={AlertHistoryScreen}
        options={{ title: 'Alert History' }}
      />
      <Stack.Screen
        name="About"
        component={AboutScreen}
        options={{ title: 'About' }}
      />
      <Stack.Screen
        name="NewsFeed"
        component={NewsFeedScreen}
        options={{ title: 'News Feed' }}
      />
    </Stack.Navigator>
  );
}

const makeStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    headerContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: colors.bg,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      paddingBottom: 10,
      paddingHorizontal: spacing.md,
    },
    iconBtn: {
      width: 40,
      height: 40,
      borderRadius: radius.full,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
  });
