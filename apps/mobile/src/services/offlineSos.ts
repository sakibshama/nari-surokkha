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

const CONTACTS_CACHE_KEY = '@trusted_contacts';

// National emergency SMS gateway / police shortcode fallback.
// Included so an SOS still reaches authorities even with zero contacts.
const EMERGENCY_GATEWAY_NUMBERS: string[] = ['999'];

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

async function getCachedContactPhones(): Promise<string[]> {
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
  const who = userName && userName.trim() ? userName.trim() : 'I';
  const verb = who === 'I' ? 'am' : 'is';
  if (coords) {
    const link = `https://maps.google.com/?q=${coords.latitude},${coords.longitude}`;
    return `SOS EMERGENCY! ${who} ${verb} in danger and offline. Location: ${link} (lat ${coords.latitude.toFixed(
      5,
    )}, lng ${coords.longitude.toFixed(5)}). Please send help / call 999.`;
  }
  return `SOS EMERGENCY! ${who} ${verb} in danger and offline. Location unavailable. Please try to reach me and call 999.`;
}

/**
 * Opens the native SMS composer prefilled with the emergency message and
 * trusted-contact recipients. Returns a status describing what happened.
 */
export async function sendOfflineSosSms(
  options: OfflineSosOptions = {},
): Promise<{ opened: boolean; reason?: string }> {
  const available = await SMS.isAvailableAsync();
  if (!available) {
    return { opened: false, reason: 'SMS is not available on this device.' };
  }

  const coords = await resolveCoords(options.coords);
  const message = buildSosMessage(options.userName, coords);

  const contactPhones = await getCachedContactPhones();
  const recipients = [
    ...(options.includeGateway !== false ? EMERGENCY_GATEWAY_NUMBERS : []),
    ...contactPhones,
  ];

  if (recipients.length === 0) {
    return { opened: false, reason: 'No trusted contacts saved for offline SMS.' };
  }

  try {
    await SMS.sendSMSAsync(recipients, message);
    return { opened: true };
  } catch (err) {
    return { opened: false, reason: (err as Error)?.message || 'Failed to open SMS composer.' };
  }
}
