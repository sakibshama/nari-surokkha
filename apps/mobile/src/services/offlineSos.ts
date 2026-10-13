/**
 * Offline SOS SMS fallback.
 *
 * When the phone has no internet connection, or the online SOS call fails,
 * or the server reports that SMS dispatch failed, we fall back to the
 * device's built-in Messages app. On Android/iOS `expo-sms` opens the
 * native composer prefilled with the emergency text, a Google Maps link,
 * and the trusted contacts as recipients — the user just taps Send, which
 * goes over the cellular network with no data required.
 *
 * Trusted contacts are read from the AsyncStorage cache that
 * TrustedContactsScreen keeps up to date (`@trusted_contacts`).
 */

import * as SMS from 'expo-sms';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { trySendDirectSms } from './directSms';
import { logSms } from './smsHistory';
import { tStatic } from '../i18n';
import { buildSosText } from './sosText';
import { recordOfflineSos } from './offlineEscalation';

const CONTACTS_CACHE_KEY = '@trusted_contacts';

// National emergency SMS gateway fallback.
// PILOT MODE: disabled — do not SMS 999 until the service is officially
// integrated with the national emergency gateway. Re-enable at launch by
// restoring ['999'] and passing includeGateway: true.
const EMERGENCY_GATEWAY_NUMBERS: string[] = [];

interface Coords {
  latitude: number;
  longitude: number;
}

export interface OfflineSosOptions {
  /** Known coordinates; if omitted we try last-known GPS. */
  coords?: Coords;
  /** Sender's name for the message body. */
  userName?: string;
  /** Include the 999 gateway shortcode alongside contacts. */
  includeGateway?: boolean;
  /** Remember this SOS so it is sent online when the connection returns (default true). */
  recordForEscalation?: boolean;
}

async function resolveCoords(explicit?: Coords): Promise<Coords | null> {
  if (explicit) return explicit;
  try {
    const loc = await Location.getLastKnownPositionAsync();
    if (loc) return { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
  } catch {
    /* ignore */
  }
  return null;
}

export async function getCachedContactPhones(): Promise<string[]> {
  try {
    const cached = await AsyncStorage.getItem(CONTACTS_CACHE_KEY);
    if (!cached) return [];
    const contacts = JSON.parse(cached) as Array<{ phone?: string }>;
    return contacts.map((c) => c.phone).filter((p): p is string => !!p);
  } catch {
    return [];
  }
}

export function buildSosMessage(userName: string | undefined, coords: Coords | null): string {
  return buildSosText(tStatic, userName, coords);
}

/**
 * Opens the native SMS composer prefilled with the emergency message and
 * trusted-contact recipients. Returns a status describing what happened.
 */
export async function sendOfflineSosSms(
  options: OfflineSosOptions = {},
): Promise<{ opened: boolean; reason?: string; auto?: boolean }> {
  const coords = await resolveCoords(options.coords);
  const message = buildSosMessage(options.userName, coords);

  const contactPhones = await getCachedContactPhones();
  const recipients = [
    ...(options.includeGateway !== false ? EMERGENCY_GATEWAY_NUMBERS : []),
    ...contactPhones,
  ];

  // Remember it, so the full online SOS goes out once the internet is back.
  if (options.recordForEscalation !== false) await recordOfflineSos(coords);

  if (recipients.length === 0) {
    await logSms({ channel: 'offline-sim', recipients, message, status: 'failed', reason: 'No trusted contacts saved.' });
    return { opened: false, reason: tStatic('No trusted contacts saved for offline SMS.') };
  }

  // 1. Preferred: silent auto-send via the SIM (Android + SEND_SMS granted).
  //    Only counts as sent once the network accepted every SMS part.
  const direct = await trySendDirectSms(recipients, message);
  if (direct.sent.length) {
    await logSms({ channel: 'offline-sim', recipients: direct.sent, message, status: 'auto' });
  }
  if (direct.failed.length === 0) return { opened: true, auto: true };

  // 2. Fallback for whoever was not texted: the native composer.
  const rest = direct.failed;
  const available = await SMS.isAvailableAsync().catch(() => false);
  if (!available) {
    const reason = direct.error || 'SMS not available on device.';
    await logSms({ channel: 'offline-sim', recipients: rest, message, status: 'failed', reason });
    return direct.sent.length
      ? { opened: true, auto: true }
      : { opened: false, reason: tStatic('SMS is not available on this device.') };
  }
  try {
    const { result } = await SMS.sendSMSAsync(rest, message);
    if (result === 'cancelled') {
      await logSms({ channel: 'offline-sim', recipients: rest, message, status: 'failed', reason: 'Cancelled in Messages.' });
      return direct.sent.length ? { opened: true, auto: true } : { opened: false, reason: tStatic('The SMS was not sent.') };
    }
    await logSms({ channel: 'offline-sim', recipients: rest, message, status: 'manual' });
    return { opened: true, auto: false };
  } catch (err) {
    const reason = (err as Error)?.message || 'Failed to open SMS composer.';
    await logSms({ channel: 'offline-sim', recipients: rest, message, status: 'failed', reason });
    return direct.sent.length ? { opened: true, auto: true } : { opened: false, reason };
  }
}
