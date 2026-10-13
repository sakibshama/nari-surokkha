import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * SOS + tracking state. The active SOS (alert id, start time) is persisted, so
 * an app restart resumes tracking and Home still shows the live SOS.
 */
const SOS_KEY = '@active_sos_v1';

export type TrackingMode = 'background' | 'foreground' | 'none';

interface LocationState {
  isSosActive: boolean;
  activeAlertId: string | null;
  sosStartedAt: number | null;
  activeRouteId: string | null;
  /** How location is being collected right now. */
  trackingMode: TrackingMode;
  /** Last fix the phone produced / last ping the server accepted (epoch ms). */
  lastFixAt: number | null;
  lastPingAt: number | null;
  /** Pings waiting in the offline outbox. */
  queuedPings: number;
  sosHydrated: boolean;
  setSosActive: (isActive: boolean, alertId?: string | null) => void;
  setActiveRoute: (routeId: string | null) => void;
  setTracking: (patch: Partial<Pick<LocationState, 'trackingMode' | 'lastFixAt' | 'lastPingAt' | 'queuedPings'>>) => void;
}

export const useLocationStore = create<LocationState>((set) => ({
  isSosActive: false,
  activeAlertId: null,
  sosStartedAt: null,
  activeRouteId: null,
  trackingMode: 'none',
  lastFixAt: null,
  lastPingAt: null,
  queuedPings: 0,
  sosHydrated: false,

  setSosActive: (isActive, alertId = null) => {
    const active = isActive && !!alertId;
    const startedAt = active ? Date.now() : null;
    set({ isSosActive: isActive, activeAlertId: alertId, sosStartedAt: startedAt, lastPingAt: null, queuedPings: 0 });
    const write = active
      ? AsyncStorage.setItem(SOS_KEY, JSON.stringify({ alertId, startedAt }))
      : AsyncStorage.removeItem(SOS_KEY);
    write.catch(() => {});
  },

  setActiveRoute: (routeId) => {
    set({ activeRouteId: routeId });
  },

  setTracking: (patch) => set(patch),
}));

let hydration: Promise<void> | null = null;

/** Restore a persisted SOS once (also called from the headless location task). */
export function hydrateSosState(): Promise<void> {
  if (!hydration) {
    hydration = (async () => {
      try {
        const raw = await AsyncStorage.getItem(SOS_KEY);
        const saved = raw ? (JSON.parse(raw) as { alertId?: string; startedAt?: number }) : null;
        if (saved?.alertId && !useLocationStore.getState().isSosActive) {
          useLocationStore.setState({ isSosActive: true, activeAlertId: saved.alertId, sosStartedAt: saved.startedAt ?? null });
        }
      } catch {
        /* nothing saved */
      } finally {
        useLocationStore.setState({ sosHydrated: true });
      }
    })();
  }
  return hydration;
}

/** Forget the SOS (logout). */
export async function clearSosState(): Promise<void> {
  useLocationStore.setState({ isSosActive: false, activeAlertId: null, sosStartedAt: null, activeRouteId: null });
  await AsyncStorage.removeItem(SOS_KEY).catch(() => {});
}
