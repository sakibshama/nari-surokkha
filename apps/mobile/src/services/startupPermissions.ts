/**
 * Every permission the safety features need, asked once, the first time the
 * app opens.
 *
 * Before this, each permission was asked by the screen that first needed it
 * (SMS on the home screen, the microphone only when detection was switched
 * on, camera only when recording evidence…). A permission that was dismissed
 * or never reached then had to be switched on by hand in Android settings —
 * and an SOS pressed in a hurry met a permission dialog instead of sending.
 *
 * Android asks for all of them in one batch (the system shows one dialog per
 * group, back to back). iOS has no batch API, so the expo modules are asked
 * one after another.
 *
 * Background ("all the time") location is deliberately not asked here: on
 * Android 11+ it can only be granted on a settings page, which is exactly the
 * manual step this avoids. Live tracking during an SOS runs as a foreground
 * service, which needs only the regular location permission.
 */

import { Platform, PermissionsAndroid, type Permission } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import * as ImagePicker from 'expo-image-picker';
import { AudioModule } from 'expo-audio';
import { recordSmsRequestResult, useSmsPermission } from './smsPermission';

const ASKED_KEY = '@startup_permissions_v1';

/** The permissions an SOS cannot work without; re-asked on later launches if still missing. */
const CRITICAL_ANDROID: Permission[] = [
  PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
  PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
  PermissionsAndroid.PERMISSIONS.SEND_SMS,
];

function androidPermissions(): Permission[] {
  const list: Permission[] = [
    ...CRITICAL_ANDROID,
    PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
    PermissionsAndroid.PERMISSIONS.CAMERA,
    // Dual-SIM phones set to "Ask every time" have no default SMS SIM: this
    // lets the emergency SMS pick an active SIM itself instead of Android
    // popping a SIM chooser in the middle of an SOS.
    PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE,
  ];
  // Notification permission exists only from Android 13 (API 33).
  if (typeof Platform.Version === 'number' && Platform.Version >= 33) {
    list.push(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
  }
  return list;
}

async function missing(perms: Permission[]): Promise<Permission[]> {
  const checks = await Promise.all(
    perms.map(async (p) => ((await PermissionsAndroid.check(p).catch(() => false)) ? null : p)),
  );
  return checks.filter((p): p is Permission => p !== null);
}

async function askAndroid(firstRun: boolean): Promise<void> {
  // First run: everything. Later launches: only what an SOS needs, so a
  // permission the user turned down by accident is offered again — Android
  // itself stops showing the dialog after the user declines twice.
  const wanted = await missing(firstRun ? androidPermissions() : CRITICAL_ANDROID);
  if (wanted.length) {
    const results = await PermissionsAndroid.requestMultiple(wanted);
    await recordSmsRequestResult(results[PermissionsAndroid.PERMISSIONS.SEND_SMS]);
  }

  // Emergency SMS is the one permission Android may refuse WITHOUT a dialog
  // (Android 15+ for apps installed from an APK: "restricted settings"; or
  // after "Don't ask again"). Then the only way is the app's settings page,
  // so explain the exact steps instead of leaving the feature silently off.
  const sms = await useSmsPermission.getState().refresh();
  if (sms === 'restricted' || sms === 'blocked') useSmsPermission.getState().showGuide();
}

async function askIos(): Promise<void> {
  // One after another: iOS shows a single system alert at a time.
  const steps: Array<() => Promise<unknown>> = [
    () => Location.requestForegroundPermissionsAsync(),
    () => Notifications.requestPermissionsAsync(),
    () => AudioModule.requestRecordingPermissionsAsync(),
    () => ImagePicker.requestCameraPermissionsAsync(),
  ];
  for (const step of steps) {
    // eslint-disable-next-line no-await-in-loop
    await step().catch(() => undefined);
  }
}

let running: Promise<void> | null = null;

/**
 * Ask for the app's permissions. Call once the first screen is visible (a
 * system dialog over the splash animation is easy to miss). Safe to call on
 * every launch: the full set is asked only on the first one.
 */
export function requestStartupPermissions(): Promise<void> {
  if (Platform.OS === 'web') return Promise.resolve();
  if (!running) {
    running = (async () => {
      try {
        const firstRun = !(await AsyncStorage.getItem(ASKED_KEY).catch(() => null));
        if (Platform.OS === 'android') await askAndroid(firstRun);
        else if (firstRun) await askIos();
        if (firstRun) await AsyncStorage.setItem(ASKED_KEY, new Date().toISOString()).catch(() => undefined);
      } catch {
        /* never block the app on a permission prompt */
      } finally {
        running = null;
      }
    })();
  }
  return running;
}
