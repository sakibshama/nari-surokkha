/**
 * Local SOS SMS history.
 *
 * Records both delivery channels so the user can see exactly how each alert
 * went out:
 *   • offline-sim   — sent directly from this phone's SIM (auto or composer)
 *   • online-server — dispatched by the server via the SMS gateway (BulkSMSBD)
 *
 * Stored on-device only (AsyncStorage), capped, most-recent-first.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = '@sms_history';
const MAX = 50;

export type SmsChannel = 'offline-sim' | 'online-server';
// offline outcomes: auto (silent), manual (composer), failed.
// online outcome: sent (server accepted the dispatch).
export type SmsStatus = 'auto' | 'manual' | 'failed' | 'sent';

export interface SmsHistoryEntry {
  id: string;
  at: number; // epoch ms
  channel: SmsChannel;
  status: SmsStatus;
  recipients: string[];
  message: string;
  reason?: string;
}

export async function getSmsHistory(): Promise<SmsHistoryEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as SmsHistoryEntry[]) : [];
  } catch {
    return [];
  }
}

export async function logSms(entry: {
  channel: SmsChannel;
  status: SmsStatus;
  recipients: string[];
  message: string;
  reason?: string;
}): Promise<void> {
  try {
    const list = await getSmsHistory();
    const full: SmsHistoryEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      at: Date.now(),
      ...entry,
    };
    await AsyncStorage.setItem(KEY, JSON.stringify([full, ...list].slice(0, MAX)));
  } catch {
    /* history is best-effort — never block an SOS on it */
  }
}

export async function clearSmsHistory(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    /* noop */
  }
}
