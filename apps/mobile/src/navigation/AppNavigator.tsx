import React, { useEffect, useMemo } from 'react';
import {
  DarkTheme,
  DefaultTheme,
  NavigationContainer,
  Theme as NavTheme,
} from '@react-navigation/native';
import { ActivityIndicator, Linking, View } from 'react-native';

import { useAuthStore } from '../store/authStore';
import AuthStack from './AuthStack';
import DrawerNavigator from './DrawerNavigator';
import { registerDeviceTokenWithServer } from '../services/pushNotifications';
import { useSettingsStore } from '../store/settingsStore';
import { useTheme } from '../theme';
import { currentRouteName, navigateMain, navigationRef } from './navigationRef';
import EmergencyRuntime from '../components/EmergencyRuntime';

export default function AppNavigator() {
  const { isAuthenticated, isLoading, restoreToken } = useAuthStore();
  const { colors, isDark } = useTheme();

  useEffect(() => {
    restoreToken();
  }, [restoreToken]);

  useEffect(() => {
    if (!isAuthenticated) return;
    (async () => {
      await useSettingsStore.getState().hydrate();
      // The Settings switch decides whether this device gets push at all.
      if (!useSettingsStore.getState().pushEnabled) return;
      await registerDeviceTokenWithServer().catch((err) => {
        if (__DEV__) console.warn('Failed to register device token:', err);
      });
    })();
  }, [isAuthenticated]);

  // Payment deep link (narisurokkha://subscription?trx=…): open the
  // Subscription screen, including when the link cold-starts the app.
  useEffect(() => {
    if (!isAuthenticated) return;
    const open = (url: string | null) => {
      if (!url?.startsWith('narisurokkha://subscription')) return;
      if (currentRouteName() === 'Subscription') return; // the screen handles it
      const m = /[?&]trx=([^&]+)/.exec(url);
      const params = m ? { trx: decodeURIComponent(m[1]) } : undefined;
      const go = () => navigateMain('Subscription', params);
      if (!go()) setTimeout(go, 800); // navigator not ready yet on a cold start
    };
    void Linking.getInitialURL().then(open);
    const sub = Linking.addEventListener('url', ({ url }) => open(url));
    return () => sub.remove();
  }, [isAuthenticated]);

  /**
   * React Navigation paints the space between screens during transitions with
   * its own theme. Left on the default it flashes white on every push in dark
   * mode, which is exactly the kind of detail that makes an app feel unfinished.
   */
  const navTheme: NavTheme = useMemo(() => {
    const base = isDark ? DarkTheme : DefaultTheme;
    return {
      ...base,
      dark: isDark,
      colors: {
        ...base.colors,
        primary: colors.accent,
        background: colors.bg,
        card: colors.surface,
        text: colors.text,
        border: colors.border,
        notification: colors.danger,
      },
    };
  }, [isDark, colors]);

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  return (
    <NavigationContainer theme={navTheme} ref={navigationRef}>
      {isAuthenticated ? <DrawerNavigator /> : <AuthStack />}
      {/* Microphone emergency detection + soft alerts, only while signed in. */}
      {isAuthenticated && <EmergencyRuntime />}
    </NavigationContainer>
  );
}
