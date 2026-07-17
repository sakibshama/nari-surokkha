import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { useAuthStore } from '../store/authStore';
import AuthStack from './AuthStack';
import DrawerNavigator from './DrawerNavigator';
import { View, ActivityIndicator, StyleSheet, Platform } from 'react-native';
import { registerForPushNotificationsAsync } from '../services/pushNotifications';
import api from '../services/api';

export default function AppNavigator() {
  const { isAuthenticated, isLoading, restoreToken } = useAuthStore();

  useEffect(() => {
    restoreToken();
  }, [restoreToken]);

  useEffect(() => {
    if (isAuthenticated) {
      registerForPushNotificationsAsync().then((token) => {
        if (token) {
          api.post('/auth/device-token', {
            token,
            platform: Platform.OS === 'ios' ? 'ios' : 'android'
          }).catch(err => console.error('Failed to register device token:', err));
        }
      });
    }
  }, [isAuthenticated]);

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#ef4444" />
      </View>
    );
  }

  return (
    <NavigationContainer>
      {isAuthenticated ? <DrawerNavigator /> : <AuthStack />}
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
