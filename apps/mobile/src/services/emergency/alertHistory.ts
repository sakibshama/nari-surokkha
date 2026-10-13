/**
 * On-device history of soft alerts: what triggered them, how confident the
 * model was, and how each one ended. Kept locally (max HISTORY_LIMIT entries)
 * so the user can review and tune detection even when offline.
 */

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { HISTORY_LIMIT } from './constants';

const STORAGE_KEY = 'emergency_alert_history_v1';

export type AlertSource = 'shout' | 'help' | 'cry' | 'bachao' | 'motion' | 'manual' | 'route';

export type AlertOutcome =
  | 'pending' // countdown running
  | 'cancelled' // user said "I'm okay"
  | 'confirmed' // user tapped "I need help"
  | 'auto_confirmed' // countdown reached zero
  | 'sent_offline' // no server — SMS sent from the phone
  | 'failed' // could not alert anyone (see detail)
  | 'suppressed'; // duplicate / cooldown — no alert was raised

export interface AlertHistoryEntry {
  id: string;
  source: AlertSource;
  confidence?: number;
  startedAt: number;
  endedAt?: number;
  outcome: AlertOutcome;
  /** Server alert id, when the server was reached. */
  alertId?: string;
  /** Raised while the app was in the background. */
  background?: boolean;
  /** Extra triggers that fired while this alert was already counting down. */
  duplicates?: number;
  /** Suppressed entries: how many detections were merged into this row. */
  count?: number;
  /** Human-readable reason (failure message, suppression reason). */
  detail?: string;
}

interface HistoryState {
  entries: AlertHistoryEntry[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  add: (e: AlertHistoryEntry) => void;
  update: (id: string, patch: Partial<AlertHistoryEntry>) => void;
  clear: () => void;
}

let writeTimer: ReturnType<typeof setTimeout> | null = null;
function persist(entries: AlertHistoryEntry[]) {
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(entries)).catch(() => {});
  }, 250);
}

export const useAlertHistory = create<HistoryState>((set, get) => ({
  entries: [],
  hydrated: false,
  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      const stored: AlertHistoryEntry[] = raw ? JSON.parse(raw) : [];
      // Anything still "pending" from a previous run was interrupted (app killed).
      const fixed = stored.map((e) =>
        e.outcome === 'pending' ? { ...e, outcome: 'failed' as const, detail: e.detail ?? 'Interrupted (app closed)' } : e,
      );
      // Entries added before hydration finished win over stored ones.
      const current = get().entries;
      const ids = new Set(current.map((e) => e.id));
      set({ entries: [...current, ...fixed.filter((e) => !ids.has(e.id))].slice(0, HISTORY_LIMIT) });
    } catch {
      /* start empty */
    } finally {
      set({ hydrated: true });
    }
  },
  add: (e) => {
    const entries = [e, ...get().entries].slice(0, HISTORY_LIMIT);
    set({ entries });
    persist(entries);
  },
  update: (id, patch) => {
    const entries = get().entries.map((e) => (e.id === id ? { ...e, ...patch } : e));
    set({ entries });
    persist(entries);
  },
  clear: () => {
    set({ entries: [] });
    persist([]);
  },
}));
