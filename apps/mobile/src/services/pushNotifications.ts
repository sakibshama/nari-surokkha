import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import api from './api';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

const PUSH_TOKEN_KEY = '@push_token';

export async function registerForPushNotificationsAsync(): Promise<string | null> {
  let token = null;

  // Push tokens are not supported on web — skip quietly to avoid the
  // "Failed to get push token" noise and an unnecessary permission prompt.
  if (Platform.OS === 'web') {
    return null;
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('emergency-alerts', {
      name: 'Emergency Alerts',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#ef4444',
    });
  }

  if (Device.isDevice) {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      if (__DEV__) console.log('Failed to get push token for push notification!');
      return null;
    }

    try {
      const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
      if (!projectId) {
        if (__DEV__) console.warn('Project ID not found in app.json for push tokens');
      }

      const tokenResponse = await Notifications.getExpoPushTokenAsync({
        projectId,
      });
      token = tokenResponse.data;
      if (__DEV__) console.log('Expo Push Token generated');
    } catch (e) {
      if (__DEV__) console.error('Error fetching push token:', e);
    }
  } else {
    if (__DEV__) console.log('Must use physical device for Push Notifications');
  }

  return token;
}

/**
 * Register this device's push token with the server (POST /auth/device-token).
 * Returns false when there is no token (web, simulator, permission denied).
 */
export async function registerDeviceTokenWithServer(): Promise<boolean> {
  const token = await registerForPushNotificationsAsync();
  if (!token) return false;
  await api.post('/auth/device-token', { token, platform: Platform.OS === 'ios' ? 'ios' : 'android' });
  await AsyncStorage.setItem(PUSH_TOKEN_KEY, token).catch(() => {});
  return true;
}

/**
 * Stop push for this install: the server stops sending to the token
 * (DELETE /auth/device-token — call this while still signed in), and the token
 * itself is invalidated on the device. A later registration gets a fresh one.
 */
export async function unregisterPush(): Promise<void> {
  if (Platform.OS === 'web') return;
  const token = await AsyncStorage.getItem(PUSH_TOKEN_KEY).catch(() => null);
  if (token) {
    await api.delete('/auth/device-token', { data: { token }, timeout: 8000 }).catch(() => {});
    await AsyncStorage.removeItem(PUSH_TOKEN_KEY).catch(() => {});
  }
  try {
    await Notifications.unregisterForNotificationsAsync();
  } catch {
    /* best-effort */
  }
}
