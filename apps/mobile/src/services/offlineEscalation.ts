/**
 * Sends the full online SOS automatically once the internet returns after an
 * SMS-only (offline) SOS — once, and only within ESCALATION_WINDOW_MS.
 * The decision itself lives in offlineEscalationCore.ts (unit tested).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import * as Location from 'expo-location';
import { AppState } from 'react-native';
import api from './api';
import { decideEscalation, type PendingOfflineSos } from './offlineEscalationCore';
import { useLocationStore } from '../store/locationStore';
import { useAuthStore } from '../store/authStore';
import { showResultNotification } from './emergency/alertNotifications';
import { navigateMain } from '../navigation/navigationRef';
import { tStatic } from '../i18n';
import { toast } from '../utils/notify';

const KEY = '@pending_offline_sos_v1';

async function read(): Promise<PendingOfflineSos | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as PendingOfflineSos) : null;
  } catch {
    return null;
  }
}

async function write(p: PendingOfflineSos | null): Promise<void> {
  try {
    if (p) await AsyncStorage.setItem(KEY, JSON.stringify(p));
    else await AsyncStorage.removeItem(KEY);
  } catch {
    /* best-effort */
  }
}

/** Remember an offline SOS. A newer one replaces an older, un-escalated one. */
export async function recordOfflineSos(coords: { latitude: number; longitude: number } | null): Promise<void> {
  const existing = await read();
  // A resend without a fix keeps the location of the earlier one.
  const keep = existing && !existing.escalated ? existing.coords : null;
  await write({ at: Date.now(), coords: coords ?? keep });
}

export const clearOfflineSos = (): Promise<void> => write(null);

let running = false;

async function check(online: boolean): Promise<void> {
  if (running) return;
  running = true;
  try {
    const pending = await read();
    const decision = decideEscalation(pending, {
      now: Date.now(),
      online,
      authenticated: useAuthStore.getState().isAuthenticated,
      sosActive: useLocationStore.getState().isSosActive,
    });
    if (decision.action === 'wait' || !pending) return;
    if (decision.action === 'discard') {
      await write(null);
      return;
    }

    let coords = pending.coords;
    if (!coords) {
      const last = await Location.getLastKnownPositionAsync().catch(() => null);
      if (last) coords = { latitude: last.coords.latitude, longitude: last.coords.longitude };
    }
    if (!coords) {
      // The API needs a location; the contacts already have the SMS.
      await write(null);
      return;
    }

    // Mark first: the online SOS is created at most once.
    await write({ ...pending, escalated: true });
    try {
      const res = await api.post('/alerts/sos', { latitude: coords.latitude, longitude: coords.longitude });
      const id: string | undefined = res.data?.data?.id;
      if (!id) throw new Error('No alert id');
      useLocationStore.getState().setSosActive(true, id);
      const title = tStatic('Back online — SOS sent');
      const body = tStatic('Your offline SOS is now live: contacts and responders get your live location.');
      if (AppState.currentState === 'active') {
        toast(title, body, 'success');
        navigateMain('ActiveSos', { alertId: id });
      } else {
        await showResultNotification(title, body, { type: 'active_sos', alertId: id });
      }
      await write(null);
    } catch (e) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      // Still unreachable: try again on the next connectivity change.
      if (!status) await write({ ...pending, escalated: false });
      else await write(null);
    }
  } finally {
    running = false;
  }
}

/** Watch connectivity while signed in. Returns the unsubscribe function. */
export function startOfflineEscalationWatcher(): () => void {
  return NetInfo.addEventListener((s) => {
    if (s.isConnected && s.isInternetReachable !== false) void check(true);
  });
}
