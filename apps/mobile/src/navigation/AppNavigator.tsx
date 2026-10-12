import React, { useEffect, useMemo } from 'react';
import {
  DarkTheme,
  DefaultTheme,
  NavigationContainer,
  Theme as NavTheme,
} from '@react-navigation/native';
import { ActivityIndicator, Platform, View } from 'react-native';

import { useAuthStore } from '../store/authStore';
import AuthStack from './AuthStack';
import DrawerNavigator from './DrawerNavigator';
import { registerForPushNotificationsAsync } from '../services/pushNotifications';
import api from '../services/api';
import { useTheme } from '../theme';
import { navigationRef } from './navigationRef';
import EmergencyRuntime from '../components/EmergencyRuntime';

export default function AppNavigator() {
  const { isAuthenticated, isLoading, restoreToken } = useAuthStore();
  const { colors, isDark } = useTheme();

  useEffect(() => {
    restoreToken();
  }, [restoreToken]);

  useEffect(() => {
    if (isAuthenticated) {
      registerForPushNotificationsAsync().then((token) => {
        if (token) {
          api
            .post('/auth/device-token', {
              token,
              platform: Platform.OS === 'ios' ? 'ios' : 'android',
            })
            .catch((err) => console.error('Failed to register device token:', err));
        }
      });
    }
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
