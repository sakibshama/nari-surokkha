/** Permission status + requests for automatic emergency detection. */

import { Platform } from 'react-native';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { AudioModule } from 'expo-audio';

export type PermState = 'granted' | 'denied' | 'undetermined' | 'unavailable';

export interface DetectionPermissions {
  microphone: PermState;
  notifications: PermState;
  location: PermState;
  backgroundLocation: PermState;
}

function norm(status: string | undefined, canAskAgain?: boolean): PermState {
  if (status === 'granted') return 'granted';
  if (status === 'denied' && canAskAgain !== true) return 'denied';
  if (status === 'denied') return 'undetermined';
  return 'undetermined';
}

export async function getDetectionPermissions(): Promise<DetectionPermissions> {
  if (Platform.OS === 'web') {
    return { microphone: 'unavailable', notifications: 'unavailable', location: 'unavailable', backgroundLocation: 'unavailable' };
  }
  const [mic, notif, loc, bg] = await Promise.all([
    AudioModule.getRecordingPermissionsAsync().catch(() => null),
    Notifications.getPermissionsAsync().catch(() => null),
    Location.getForegroundPermissionsAsync().catch(() => null),
    Location.getBackgroundPermissionsAsync().catch(() => null),
  ]);
  return {
    microphone: mic ? norm(mic.status, mic.canAskAgain) : 'unavailable',
    notifications: notif ? norm(notif.status, notif.canAskAgain) : 'unavailable',
    location: loc ? norm(loc.status, loc.canAskAgain) : 'unavailable',
    backgroundLocation: bg ? norm(bg.status, bg.canAskAgain) : 'unavailable',
  };
}

export async function requestMicrophone(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    const r = await AudioModule.requestRecordingPermissionsAsync();
    return r.granted;
  } catch {
    return false;
  }
}

export async function hasMicrophone(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    return (await AudioModule.getRecordingPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

export async function requestNotifications(): Promise<boolean> {
  try {
    const r = await Notifications.requestPermissionsAsync();
    return r.status === 'granted';
  } catch {
    return false;
  }
}

export async function requestLocation(): Promise<boolean> {
  try {
    const r = await Location.requestForegroundPermissionsAsync();
    return r.status === 'granted';
  } catch {
    return false;
  }
}

export async function requestBackgroundLocation(): Promise<boolean> {
  try {
    if (!(await requestLocation())) return false;
    const r = await Location.requestBackgroundPermissionsAsync();
    return r.status === 'granted';
  } catch {
    return false;
  }
}
