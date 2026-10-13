/**
 * Location tracking for an active SOS and for Safe Route.
 *
 *  - Reference counted by reason ('sos', 'route'): the OS task stops only when
 *    nobody needs it any more (see trackingCore.ts).
 *  - Background when the user allows it ("Allow all the time" + the Settings
 *    switch). Otherwise a foreground watcher streams the location while the
 *    app is open — an SOS never goes without tracking because of a permission.
 *  - Google Play requires a prominent in-app disclosure BEFORE the background
 *    location request; it is shown once, and the answer is remembered.
 */
import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, Platform } from 'react-native';
import api from './api';
import { hydrateSosState, useLocationStore, type TrackingMode } from '../store/locationStore';
import { useSettingsStore } from '../store/settingsStore';
import { sendOrQueue, flush, pendingCount, clear as clearOutbox } from './locationOutbox';
import { TrackingReasons, type TrackingReason } from './trackingCore';
import { tStatic } from '../i18n';
import { showAlert } from '../utils/notify';

export type { TrackingReason } from './trackingCore';

const LOCATION_TASK_NAME = 'background-location-task';
const DISCLOSURE_KEY = '@bg_location_disclosure_v1';

// ─── Route deviation hand-off ──────────────────────────────────────────────
// Set by the emergency runtime (avoids an import cycle with it).
type DeviationHandler = (alertId: string, routeId: string) => void;
let onRouteDeviation: DeviationHandler | null = null;
export function setRouteDeviationHandler(fn: DeviationHandler | null): void {
  onRouteDeviation = fn;
}

// ─── One location fix → the server ─────────────────────────────────────────
async function handleLocation(loc: Location.LocationObject): Promise<void> {
  await hydrateSosState();
  const store = useLocationStore.getState();
  const { isSosActive, activeAlertId, activeRouteId } = store;
  store.setTracking({ lastFixAt: Date.now() });

  if (isSosActive && activeAlertId) {
    // Queued rather than dropped when offline: a silent gap in the trail is
    // indistinguishable from "she stopped moving".
    const delivered = await sendOrQueue({
      alertId: activeAlertId,
      latitude: loc.coords.latitude,
      longitude: loc.coords.longitude,
      accuracy: loc.coords.accuracy ?? undefined,
      timestamp: new Date(loc.timestamp ?? Date.now()).toISOString(),
    });
    if (delivered) {
      store.setTracking({ lastPingAt: Date.now() });
      await flush();
    }
    store.setTracking({ queuedPings: await pendingCount() });
  }

  if (activeRouteId) {
    try {
      const res = await api.post(`/alerts/safe-route/${activeRouteId}/location`, {
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
      });
      const d = res.data?.data as { deviated?: boolean; alertId?: string } | undefined;
      // The server raises a soft alert once, when the route first deviates.
      if (d?.alertId) onRouteDeviation?.(d.alertId, activeRouteId);
    } catch (err) {
      if (__DEV__) console.warn('Safe-route ping failed:', err);
    }
  }
}

if (Platform.OS !== 'web') {
  TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
    if (error) {
      if (__DEV__) console.error('Background location task error:', error);
      return;
    }
    const locations = (data as { locations?: Location.LocationObject[] } | undefined)?.locations;
    const loc = locations?.[locations.length - 1];
    if (!loc) return;
    try {
      await handleLocation(loc);
    } catch (err) {
      if (__DEV__) console.error('Failed to send background location:', err);
    }
  });
}

// ─── Prominent disclosure (Play policy) ────────────────────────────────────
function showDisclosure(): Promise<boolean> {
  return new Promise((resolve) => {
    showAlert(
      tStatic('Background location'),
      tStatic(
        'Nari Surokkha collects your location in the background, even when the app is closed or not in use, while an SOS or a Safe Route is active. It is sent only to your trusted contacts, responders and our server so they can find you. Next, choose "Allow all the time".',
      ),
      [
        { text: tStatic('Not now'), style: 'cancel', onPress: () => resolve(false) },
        { text: tStatic('Continue'), onPress: () => resolve(true) },
      ],
    );
  });
}

/** May tracking run in the background? Asks (with the disclosure) only when interactive. */
async function backgroundAllowed(interactive: boolean): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  if (!useSettingsStore.getState().backgroundLocationEnabled) return false;
  const current = await Location.getBackgroundPermissionsAsync();
  if (current.granted) return true;
  if (!interactive || AppState.currentState !== 'active' || !current.canAskAgain) return false;

  const answered = await AsyncStorage.getItem(DISCLOSURE_KEY).catch(() => null);
  if (answered === 'declined') return false;
  if (answered !== 'accepted') {
    const ok = await showDisclosure();
    await AsyncStorage.setItem(DISCLOSURE_KEY, ok ? 'accepted' : 'declined').catch(() => {});
    if (!ok) return false;
  }
  const fg = await Location.requestForegroundPermissionsAsync();
  if (!fg.granted) return false;
  return (await Location.requestBackgroundPermissionsAsync()).granted;
}

// ─── Start / stop (ref counted, serialised) ────────────────────────────────
const reasons = new TrackingReasons();
let watcher: Location.LocationSubscription | null = null;
let queue: Promise<unknown> = Promise.resolve();

function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

const setMode = (trackingMode: TrackingMode) => useLocationStore.getState().setTracking({ trackingMode });

async function osTaskRunning(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  return Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME).catch(() => false);
}

async function stopAll(): Promise<void> {
  watcher?.remove();
  watcher = null;
  if (await osTaskRunning()) await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME).catch(() => {});
  setMode('none');
}

async function startForeground(): Promise<TrackingMode> {
  if (watcher) return 'foreground';
  const perm = await Location.getForegroundPermissionsAsync();
  const granted = perm.granted || (AppState.currentState === 'active' && (await Location.requestForegroundPermissionsAsync()).granted);
  if (!granted) return 'none';
  watcher = await Location.watchPositionAsync(
    { accuracy: Location.Accuracy.High, timeInterval: 10000, distanceInterval: 10 },
    (loc) => void handleLocation(loc).catch(() => {}),
  );
  return 'foreground';
}

async function startBackground(): Promise<void> {
  if (!(await osTaskRunning())) {
    await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
      accuracy: Location.Accuracy.Balanced,
      // Adaptive by distance: a victim waiting in one place stops burning
      // battery on identical fixes, someone being moved reports every 10 s.
      timeInterval: 10000,
      distanceInterval: 10,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: tStatic('Nari Surokkha is active'),
        notificationBody: tStatic('Sharing your location while your SOS or safe route is active'),
        notificationColor: '#ef4444',
      },
    });
  }
  watcher?.remove();
  watcher = null;
}

/** Bring the running mode in line with the reasons, permissions and settings. */
async function ensureRunning(interactive: boolean): Promise<TrackingMode> {
  if (reasons.size === 0) {
    await stopAll();
    return 'none';
  }
  // Stream in the foreground right away; upgrade to background if allowed.
  const fgMode = (await osTaskRunning()) ? 'background' : await startForeground();
  if (await backgroundAllowed(interactive)) {
    try {
      await startBackground();
      setMode('background');
      return 'background';
    } catch (e) {
      if (__DEV__) console.warn('Background location failed, staying in the foreground:', e);
      if (!watcher) await startForeground();
    }
  } else if (await osTaskRunning()) {
    // The switch was turned off: drop to foreground-only.
    await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME).catch(() => {});
    const mode = await startForeground();
    setMode(mode);
    return mode;
  }
  const mode: TrackingMode = watcher ? 'foreground' : fgMode === 'background' ? 'background' : 'none';
  setMode(mode);
  return mode;
}

/** Start tracking for a reason. Interactive (default: app visible) may show the disclosure. */
export function startLocationTracking(
  reason: TrackingReason,
  opts: { interactive?: boolean } = {},
): Promise<TrackingMode> {
  return serial(async () => {
    reasons.add(reason);
    return ensureRunning(opts.interactive ?? AppState.currentState === 'active');
  });
}

/** Release a reason; the OS task stops only when no reason is left. */
export function stopLocationTracking(reason: TrackingReason): Promise<void> {
  return serial(async () => {
    reasons.remove(reason);
    // The alert is over; its queued trail must not be delivered against the next one.
    if (reason === 'sos') await clearOutbox();
    if (reasons.size === 0) await stopAll();
  });
}

/** Re-evaluate after the background-location setting changed. */
export function refreshLocationTracking(): Promise<TrackingMode> {
  return serial(() => ensureRunning(true));
}

/** At startup: stop an OS task left running by a previous session nobody needs now. */
export function reconcileLocationTracking(): Promise<void> {
  return serial(async () => {
    if (reasons.size === 0) await stopAll();
  });
}
