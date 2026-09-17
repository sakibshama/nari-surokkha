import { GestureHandlerRootView } from 'react-native-gesture-handler';
import React, { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View, LogBox } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import NetInfo from '@react-native-community/netinfo';
import { WifiOff } from 'lucide-react-native';
import Toast from 'react-native-toast-message';

import AppNavigator from './src/navigation/AppNavigator';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import AnimatedSplash from './src/components/AnimatedSplash';
import { ThemeProvider, useTheme } from './src/theme';
import { useLanguageStore, useT } from './src/i18n';
import { initApiTarget } from './src/services/api';

LogBox.ignoreLogs(['Attempted to import the module', 'event-target-shim']);

/**
 * Everything below the provider, so it can read the palette.
 *
 * The status bar style is derived rather than fixed: light content over the
 * dark theme, dark content over the light one. Left fixed, half the users get
 * an invisible clock.
 */
function AppShell() {
  const { colors, isDark } = useTheme();
  const t = useT();
  const [isConnected, setIsConnected] = useState<boolean | null>(true);
  const [splashDone, setSplashDone] = useState(false);

  useEffect(() => {
    // Restore the saved language before the first real screen paints.
    useLanguageStore.getState().hydrate();
    // Work out which server this app can actually reach (saved address, then
    // the dev candidates). Fire and forget: nothing blocks the first frame.
    initApiTarget().catch(() => {
      /* the request itself will report the failure */
    });
  }, []);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => setIsConnected(state.isConnected));
    return () => unsubscribe();
  }, []);

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <View
        style={[
          styles.container,
          {
            backgroundColor: colors.bg,
            ...(Platform.OS === 'web'
              ? {
                  boxShadow: isDark
                    ? '0 0 60px rgba(0,0,0,0.8)'
                    : '0 0 60px rgba(15,26,23,0.18)',
                  overflow: 'hidden',
                }
              : null),
          },
        ]}
      >
        {isConnected === false && (
          <View
            style={[
              styles.offlineBanner,
              { backgroundColor: colors.warningSoft, borderBottomColor: colors.border },
            ]}
          >
            <WifiOff color={colors.warningText} size={14} style={{ marginRight: 8 }} />
            <Text style={[styles.offlineText, { color: colors.warningText }]}>
              {t('No internet — SOS will fall back to SMS')}
            </Text>
          </View>
        )}

        <AppNavigator />
        {!splashDone && <AnimatedSplash onFinish={() => setSplashDone(true)} />}
      </View>
    </View>
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <ErrorBoundary>
            <AppShell />
            <Toast />
          </ErrorBoundary>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  container: {
    flex: 1,
    width: '100%',
    maxWidth: Platform.OS === 'web' ? 480 : undefined,
  },
  offlineBanner: {
    borderBottomWidth: 1,
    paddingVertical: 8,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  offlineText: { fontSize: 12, fontWeight: '600' },
});
