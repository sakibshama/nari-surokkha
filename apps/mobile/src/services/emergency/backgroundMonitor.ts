/**
 * Keeps the microphone available while the app is in the background.
 *
 * Android: starts a foreground service of type "microphone" through
 * react-native-background-actions. Android only lets an app use the
 * microphone from the background if such a service was started while the app
 * was visible, so start() must be called from the foreground. The service
 * shows a persistent "Listening for emergencies" notification (required by
 * Android) and keeps JS timers running for the 15 s countdown.
 *
 * iOS: the "audio" background mode (app.json) keeps an active recording
 * session alive; there is no service to start.
 */

import { AppState, Platform } from 'react-native';
import { tStatic } from '../../i18n';

interface BackgroundActions {
  start(task: (args?: unknown) => Promise<void>, options: Record<string, unknown>): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
}

let mod: BackgroundActions | null | undefined;
function load(): BackgroundActions | null {
  if (mod !== undefined) return mod;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const m = require('react-native-background-actions');
    mod = (m?.default ?? m) as BackgroundActions;
  } catch {
    mod = null;
  }
  return mod;
}

let release: (() => void) | null = null;

export function isBackgroundServiceSupported(): boolean {
  return Platform.OS === 'android' && load() !== null;
}

export function isBackgroundServiceRunning(): boolean {
  const m = load();
  try {
    return !!m?.isRunning();
  } catch {
    return false;
  }
}

/** Returns false when it could not start (unsupported, or app not in foreground). */
export async function startBackgroundListening(): Promise<boolean> {
  if (Platform.OS !== 'android') return Platform.OS === 'ios';
  const m = load();
  if (!m) return false;
  if (isBackgroundServiceRunning()) return true;
  if (AppState.currentState !== 'active') return false; // Android 14 forbids starting it from the background
  try {
    await m.start(
      () =>
        new Promise<void>((resolve) => {
          // The task does no work itself — the microphone callbacks do. It just
          // keeps the service (and the JS runtime) alive until stop().
          release = resolve;
        }),
      {
        taskName: 'NariSurokkhaListening',
        taskTitle: tStatic('Nari Surokkha is listening'),
        taskDesc: tStatic('Shout, cry, "Help" or "Bachao" starts a 15-second alert.'),
        taskIcon: { name: 'ic_launcher', type: 'mipmap' },
        color: '#e11d48',
        foregroundServiceType: ['microphone'],
      },
    );
    return true;
  } catch (e) {
    if (__DEV__) console.warn('[bg] could not start foreground service', e);
    return false;
  }
}

export async function stopBackgroundListening(): Promise<void> {
  const m = load();
  release?.();
  release = null;
  if (!m) return;
  try {
    if (m.isRunning()) await m.stop();
  } catch {
    /* already stopped */
  }
}
