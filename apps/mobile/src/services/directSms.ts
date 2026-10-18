/**
 * Direct (silent) SMS — Android only.
 *
 * With the SEND_SMS runtime permission, Android lets an app send an SMS via
 * the OS SmsManager with NO composer and NO manual tap. This is used for the
 * offline SOS path so an emergency text goes out by itself.
 *
 * The library's own sendDirectSms() uses sendTextMessage(), which silently
 * drops anything longer than one SMS part (160 GSM / 70 Bangla characters)
 * and reports nothing. We only use `sendDirectSmsMultipart()`, added by
 * patches/react-native-direct-sms+1.2.9.patch: it splits the text and
 * resolves only when every part was accepted by the network. A build without
 * the patched module counts as "not supported", so callers fall back to the
 * composer instead of believing a text went out.
 *
 * • iOS: not possible (Apple forbids programmatic SMS) → composer.
 * • Expo Go: the native module isn't present → composer.
 *
 * NOTE: Sending SMS with the user's SIM may incur their normal carrier charge.
 */
import { Platform, PermissionsAndroid } from 'react-native';
import { ensureSmsPermission } from './smsPermission';
import { prepareRecipients, sendSequentially } from './smsQueue';

export interface SmsCapability {
  telephony: boolean;
  simReady: boolean;
  permission: boolean;
  subscriptionId: number;
}

interface DirectSmsModule {
  sendDirectSmsMultipart?: (phone: string, message: string) => Promise<string>;
  getSmsCapability?: () => Promise<SmsCapability>;
}

// The native module only exists in a real build, never in Expo Go. Resolve it
// defensively so the bundle never crashes if it's absent.
let native: DirectSmsModule | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('react-native-direct-sms') as { default?: DirectSmsModule } & DirectSmsModule;
  native = mod?.default ?? mod ?? null;
} catch {
  native = null;
}

export function isDirectSmsSupported(): boolean {
  return Platform.OS === 'android' && typeof native?.sendDirectSmsMultipart === 'function';
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

/**
 * Ask for SEND_SMS if Android can still show its dialog. Never opens Settings:
 * the step-by-step guide (Android 15 "restricted settings", or "don't ask
 * again") is shown at app start and from Settings, not in the middle of an SOS.
 */
export async function requestSmsPermission(): Promise<boolean> {
  return ensureSmsPermission(false);
}

export interface DirectSmsResult {
  /** Numbers whose every SMS part was accepted by the network. */
  sent: string[];
  /** Numbers that were not (or could not be) texted silently. */
  failed: string[];
  /** First failure reason, for the SMS history. */
  error?: string;
}

/**
 * Text every recipient silently from the SIM and wait for the real result.
 * Recipients that fail (or every recipient, when silent SMS is unavailable)
 * come back in `failed` so the caller can use the composer for them.
 */
export async function trySendDirectSms(recipients: string[], message: string): Promise<DirectSmsResult> {
  const send = native?.sendDirectSmsMultipart;
  const targets = prepareRecipients(recipients);
  if (!isDirectSmsSupported() || !send || targets.length === 0) {
    return { sent: [], failed: [...recipients], error: 'Silent SMS is not available on this phone' };
  }

  // No SIM / no mobile network on this phone: say so at once, so the caller
  // falls back to the server (or the composer) instead of waiting for every
  // message to time out.
  const capability = await native?.getSmsCapability?.().catch(() => null);
  if (capability && (!capability.telephony || !capability.simReady)) {
    return { sent: [], failed: targets, error: 'No SIM card ready to send SMS' };
  }

  // A permission dialog that never answers must not hold up an emergency text.
  const granted =
    (await hasSmsPermission()) ||
    (await Promise.race([requestSmsPermission(), new Promise<boolean>((r) => setTimeout(() => r(false), 20000))]));
  if (!granted) return { sent: [], failed: targets, error: 'SMS permission not granted' };

  // One recipient at a time (see smsQueue.ts): firing them all at once
  // flooded the radio and could trigger Android's "too many messages" stop.
  return sendSequentially(targets, (n) => send(n, message));
}
