/**
 * Offline SOS SMS fallback.
 *
 * When the phone has no internet connection, or the online SOS call fails,
 * the emergency text goes to the trusted contacts silently from the SIM
 * (Android, with the SMS permission) — one plain SMS part each, no composer.
 *
 * Trusted contacts are read from the AsyncStorage cache that
 * TrustedContactsScreen keeps up to date (`@trusted_contacts`).
 */

import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { trySendDirectSms } from './directSms';
import { logSms } from './smsHistory';
import { tStatic } from '../i18n';
import { buildSosText, simSosText } from './sosText';
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
  /** The SOS press's idempotency id (the later online SOS reuses it). */
  clientSosId?: string;
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
 * Offline SOS: text the trusted contacts silently from the phone's SIM.
 *
 * Exactly one single-part SMS per contact (simSosText), sent once — never the
 * Messages composer as well: opening Messages with the SOS typed in, on top
 * of a text that had already gone out, is how contacts got the SOS twice.
 * If the phone cannot send silently (no SIM, SMS permission off), the result
 * says so and the SOS goes online as soon as the internet is back
 * (offlineEscalation.ts).
 */
export async function sendOfflineSosSms(
  options: OfflineSosOptions = {},
): Promise<{ opened: boolean; reason?: string; auto?: boolean }> {
  const coords = await resolveCoords(options.coords);
  const message = simSosText(options.userName, coords);

  const contactPhones = await getCachedContactPhones();
  const recipients = [
    ...(options.includeGateway !== false ? EMERGENCY_GATEWAY_NUMBERS : []),
    ...contactPhones,
  ];

  // Remember it, so the full online SOS goes out once the internet is back.
  if (options.recordForEscalation !== false) await recordOfflineSos(coords, options.clientSosId);

  if (recipients.length === 0) {
    await logSms({ channel: 'offline-sim', recipients, message, status: 'failed', reason: 'No trusted contacts saved.' });
    return { opened: false, reason: tStatic('No trusted contacts saved for offline SMS.') };
  }

  const direct = await trySendDirectSms(recipients, message);
  if (direct.sent.length) {
    await logSms({ channel: 'offline-sim', recipients: direct.sent, message, status: 'auto' });
  }
  if (direct.failed.length) {
    await logSms({
      channel: 'offline-sim',
      recipients: direct.failed,
      message,
      status: 'failed',
      reason: direct.error || 'SMS could not be sent from this phone.',
    });
  }
  if (direct.sent.length) return { opened: true, auto: true };
  return { opened: false, reason: smsFailureReason(direct.error) };
}

/** A short, human reason for the user (the raw error goes to the SMS history). */
function smsFailureReason(error?: string): string {
  if (error && /permission/i.test(error)) return tStatic('Emergency SMS is off. Allow SMS for Nari Surokkha in Settings.');
  if (error && /SIM/i.test(error)) return tStatic('No SIM card is ready to send SMS.');
  return tStatic('The SMS could not be sent from this phone.');
}
