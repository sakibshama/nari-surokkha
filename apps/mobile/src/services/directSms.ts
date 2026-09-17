/**
 * Direct (silent) SMS — Android only.
 *
 * With the SEND_SMS runtime permission, Android lets an app send an SMS via
 * the OS SmsManager with NO composer and NO manual tap. This is used for the
 * offline SOS path so an emergency text goes out by itself.
 *
 * • iOS: not possible (Apple forbids programmatic SMS) → callers fall back to
 *   the native composer (expo-sms).
 * • Expo Go: the native module isn't present → also falls back to composer.
 *
 * NOTE: Sending SMS with the user's SIM may incur their normal carrier charge.
 */
import { Platform, PermissionsAndroid } from 'react-native';

// The native module only exists in a real build (EAS APK), never in Expo Go.
// Resolve it defensively so the bundle never crashes if it's absent.
let nativeSend: ((numbers: string, body: string) => void) | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('react-native-direct-sms');
  nativeSend = mod?.sendDirectSms || mod?.default?.sendDirectSms || mod?.default || null;
} catch {
  nativeSend = null;
}

export function isDirectSmsSupported(): boolean {
  return Platform.OS === 'android' && typeof nativeSend === 'function';
}

/** Is SEND_SMS already granted? */
export async function hasSmsPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  try {
    return await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.SEND_SMS);
  } catch {
    return false;
  }
}

/** Prompt for SEND_SMS. Safe to call on first run / onboarding. */
export async function requestSmsPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  try {
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.SEND_SMS,
      {
        title: 'Send Emergency SMS Automatically',
        message:
          'Nari Surokkha needs SMS permission so it can text your trusted ' +
          'contacts automatically during an emergency when you have no internet. ' +
          'Standard SMS charges from your mobile operator may apply.',
        buttonPositive: 'Allow',
        buttonNegative: 'Not now',
      },
    );
    return result === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}

/**
 * Try to send an SMS silently to every recipient. Returns true only if the
 * native send was actually dispatched (Android + permission + module present).
 * On any failure the caller should fall back to the composer.
 */
export async function trySendDirectSms(recipients: string[], message: string): Promise<boolean> {
  if (!isDirectSmsSupported() || recipients.length === 0 || !nativeSend) return false;

  const granted = (await hasSmsPermission()) || (await requestSmsPermission());
  if (!granted) return false;

  try {
    // Send to each number individually for max compatibility across the
    // library's version differences (some accept ';'-joined, some don't).
    for (const number of recipients) {
      nativeSend(number, message);
    }
    return true;
  } catch {
    return false;
  }
}
