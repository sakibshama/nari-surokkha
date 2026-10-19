/**
 * Wires the detector and the soft-alert manager to the real phone:
 * microphone, TFLite models, API, location, SMS, notifications, navigation.
 *
 * Imported once by <EmergencyRuntime/> (mounted while signed in).
 */

import { AppState, Platform, Vibration } from 'react-native';
import * as Location from 'expo-location';
import api from '../api';
import { sendOfflineSosSms } from '../offlineSos';
import { sendSosSmsFromDevice } from '../deviceSms';
import { setRouteDeviationHandler } from '../backgroundTasks';
import { uploadConfirmedEmergencySample, uploadMotionSample } from '../ml/motionSampleUploader';
import { useLocationStore } from '../../store/locationStore';
import { useAuthStore } from '../../store/authStore';
import { tStatic } from '../../i18n';
import { buildSosText } from '../sosText';
import { navigateMain, currentRouteName, replaceMain } from '../../navigation/navigationRef';
import { microphoneStream } from './MicrophoneStream';
import { loadEmergencyModels } from './tfliteModels';
import { EmergencySoundDetector } from './EmergencySoundDetector';
import { ConfirmResult, Coords, NetworkUnavailableError, SoftAlertManager } from './SoftAlertManager';
import { useAlertHistory, AlertSource } from './alertHistory';
import { useDetectionSettings } from './detectionSettings';
import { SOFT_ALERT_SECONDS } from './constants';
import { dismissNotification, showResultNotification, showSoftAlertNotification } from './alertNotifications';

export function triggerLabel(source: AlertSource): string {
  switch (source) {
    case 'shout':
      return tStatic('Shout');
    case 'help':
      return tStatic('"Help"');
    case 'cry':
      return tStatic('Crying');
    case 'bachao':
      return tStatic('"Bachao"');
    case 'motion':
      return tStatic('Fall / struggle');
    case 'route':
      return tStatic('Off your safe route');
    default:
      return tStatic('Silent alert');
  }
}

function isNetworkError(e: unknown): boolean {
  const err = e as { response?: unknown; code?: string; message?: string };
  return !err?.response;
}

async function wrapApi<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (isNetworkError(e)) throw new NetworkUnavailableError((e as Error)?.message);
    const msg = (e as any)?.response?.data?.error?.message || (e as any)?.response?.data?.message || (e as Error)?.message;
    throw new Error(msg || 'Request failed');
  }
}

async function getLocation(): Promise<Coords | null> {
  try {
    const perm = await Location.getForegroundPermissionsAsync();
    if (perm.status !== 'granted') return null;
    const fix = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<null>((r) => setTimeout(() => r(null), 7000)),
    ]).catch(() => null);
    const loc = fix ?? (await Location.getLastKnownPositionAsync().catch(() => null));
    return loc ? { latitude: loc.coords.latitude, longitude: loc.coords.longitude, accuracy: loc.coords.accuracy } : null;
  } catch {
    return null;
  }
}

function userName(): string {
  return useAuthStore.getState().user?.profile?.fullName || '';
}

let notificationId: string | null = null;

export const detector = new EmergencySoundDetector(
  microphoneStream,
  loadEmergencyModels,
  useDetectionSettings.getState().triggers,
);

export const softAlerts = new SoftAlertManager({
  now: () => Date.now(),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  getLocation,
  api: {
    createSoftAlert: (c, meta) =>
      wrapApi(async () => {
        const res = await api.post('/alerts/soft', {
          latitude: c.latitude,
          longitude: c.longitude,
          accuracy: c.accuracy ?? undefined,
          mlMetadata: meta,
        });
        const id = res.data?.data?.id;
        if (!id) throw new Error('Server did not return an alert id');
        return id as string;
      }),
    cancelSoftAlert: (id) =>
      wrapApi(async () => {
        await api.patch(`/alerts/${id}/soft/cancel`);
      }),
    confirmSoftAlert: (id) =>
      wrapApi(async () => {
        const res = await api.patch(`/alerts/${id}/soft/confirm`);
        const d = res.data?.data ?? {};
        return {
          alertId: d.id ?? id,
          trackingToken: d.trackingToken,
          contactPhones: d.contactPhones,
          degradedNotifications: d.degradedNotifications,
          smsViaDevice: d.smsViaDevice,
          deviceSmsMessage: d.deviceSmsMessage,
        };
      }),
    createSos: (c) =>
      wrapApi(async () => {
        const res = await api.post('/alerts/sos', { latitude: c.latitude, longitude: c.longitude, accuracy: c.accuracy ?? undefined });
        const d = res.data?.data;
        if (!d?.id) throw new Error('Server did not return an alert id');
        return {
          alertId: d.id,
          contactPhones: d.contactPhones,
          degradedNotifications: d.degradedNotifications,
          smsViaDevice: d.smsViaDevice,
          deviceSmsMessage: d.deviceSmsMessage,
        } as ConfirmResult;
      }),
  },
  sendOfflineSms: async (c) => {
    const r = await sendOfflineSosSms({ coords: c ?? undefined, userName: userName() });
    return r.opened;
  },
  sendFallbackSms: async (result, c) => {
    // SMS limit reached (or the server could not queue it): send from the SIM.
    // sendSosSmsFromDevice asks the server to send it after all if the phone
    // cannot (no SMS permission, app in the background on iOS, …).
    const message = result.deviceSmsMessage || buildSosText(tStatic, userName(), c);
    if (!result.alertId) {
      await sendOfflineSosSms({ coords: c ?? undefined, userName: userName() });
      return;
    }
    await sendSosSmsFromDevice({
      alertId: result.alertId,
      contactPhones: result.contactPhones,
      message,
      userName: userName(),
      coords: c ?? null,
    });
  },
  isSosActive: () => useLocationStore.getState().isSosActive,
  onSosActivated: (result, viaOffline) => {
    if (viaOffline || !result.alertId) {
      if (!navigateMainIfForeground('OfflineSos')) {
        void showResultNotification(
          tStatic('Emergency SMS sent'),
          tStatic('No internet — your trusted contacts were texted from this phone.'),
          { type: 'offline_sos' },
        );
      }
      return;
    }
    // Live tracking follows the SOS state (services/sosSession.ts).
    useLocationStore.getState().setSosActive(true, result.alertId);
    if (!navigateMainIfForeground('ActiveSos', { alertId: result.alertId })) {
      void showResultNotification(
        tStatic('SOS sent'),
        tStatic('Your contacts and nearby responders are being alerted. Tap to open.'),
        { type: 'active_sos', alertId: result.alertId },
      );
    }
  },
  history: {
    add: (e) => useAlertHistory.getState().add(e),
    update: (id, patch) => useAlertHistory.getState().update(id, patch),
  },
  feedback: {
    start: (a) => {
      if (Platform.OS !== 'web') Vibration.vibrate([0, 500, 300, 500, 300, 500], true);
      void showSoftAlertNotification(a.id, triggerLabel(a.source), SOFT_ALERT_SECONDS).then((id) => {
        notificationId = id;
      });
      navigateMainIfForeground('SoftAlert', a.source === 'manual' ? { manual: true } : undefined);
    },
    stop: () => {
      Vibration.cancel();
      const id = notificationId;
      notificationId = null;
      void dismissNotification(id);
    },
  },
  isBackground: () => AppState.currentState !== 'active',
  cooldownMs: () => useDetectionSettings.getState().cooldownMs,
  onCancelled: (source) => {
    if (source === 'motion') void uploadMotionSample('normal', 'false_alarm');
  },
  onConfirmed: (source) => {
    if (source === 'motion') void uploadConfirmedEmergencySample();
  },
});

function navigateMainIfForeground(name: 'SoftAlert' | 'ActiveSos' | 'OfflineSos', params?: any): boolean {
  if (AppState.currentState !== 'active') return false;
  const here = currentRouteName();
  if (name === 'SoftAlert' && here === 'SoftAlert') return true;
  // The countdown screen is replaced by the SOS screen, not stacked under it.
  if (here === 'SoftAlert') return replaceMain(name, params);
  return navigateMain(name, params);
}

/**
 * Safe route: the server raised a soft alert because the walk left the route.
 * Show the same 15-second countdown so the user can answer "I'm okay".
 */
setRouteDeviationHandler((serverAlertId) => {
  softAlerts.trigger('route', { serverAlertId });
});

/** Sound detections become soft alerts. */
detector.onDetection((d) => {
  if (__DEV__) console.log(`[detector] ${d.trigger} ${(d.confidence * 100).toFixed(0)}%`);
  softAlerts.trigger(d.trigger, { confidence: d.confidence });
});

/** Keep the detector's thresholds in sync with the settings screen. */
useDetectionSettings.subscribe((s, prev) => {
  if (s.triggers !== prev.triggers) detector.setConfig(s.triggers);
});
