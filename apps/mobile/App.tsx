import { GestureHandlerRootView } from 'react-native-gesture-handler';
import React, { useEffect, useState } from 'react';
import { StyleSheet, View, Text, Platform, LogBox } from 'react-native';
import AppNavigator from './src/navigation/AppNavigator';

LogBox.ignoreLogs([
  'Attempted to import the module',
  'event-target-shim',
]);
import NetInfo from '@react-native-community/netinfo';
import { WifiOff } from 'lucide-react-native';
import { colors } from './src/theme';
import { ErrorBoundary } from './src/components/ErrorBoundary';

import Toast from 'react-native-toast-message';

export default function App() {
  const [isConnected, setIsConnected] = useState<boolean | null>(true);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      setIsConnected(state.isConnected);
    });
    return () => unsubscribe();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ErrorBoundary>
        <View style={styles.root}>
          <View style={styles.container}>
            {/* Offline Banner */}
            {isConnected === false && (
              <View style={styles.offlineBanner}>
                <WifiOff color="#fff" size={14} style={{ marginRight: 8 }} />
                <Text style={styles.offlineText}>
                  No Internet — SOS will fallback to SMS
                </Text>
              </View>
            )}
            <AppNavigator />
          </View>
        </View>
        <Toast />
      </ErrorBoundary>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,     // Deep dark navy — no white flash
    alignItems: 'center',
    justifyContent: 'center',
  },
  container: {
    flex: 1,
    backgroundColor: colors.bg,     // Dark background for all screens
    width: '100%',
    maxWidth: Platform.OS === 'web' ? 480 : undefined,
    ...(Platform.OS === 'web' && {
      boxShadow: '0 0 60px rgba(0,0,0,0.8)',
      overflow: 'hidden',
    }),
  },
  offlineBanner: {
    backgroundColor: '#1e293b',
    borderBottomWidth: 1,
    borderBottomColor: colors.glassBorder,
    paddingVertical: 8,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  offlineText: {
    color: colors.textSub,
    fontSize: 12,
    fontWeight: '600',
  },
});
