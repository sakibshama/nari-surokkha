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
import { tStatic } from '../i18n';

interface DirectSmsModule {
  sendDirectSmsMultipart?: (phone: string, message: string) => Promise<string>;
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

/** Prompt for SEND_SMS. Safe to call on first run / onboarding. */
export async function requestSmsPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  try {
    const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.SEND_SMS, {
      title: tStatic('Send Emergency SMS Automatically'),
      message: tStatic(
        'Nari Surokkha needs SMS permission so it can text your trusted contacts automatically during an emergency when you have no internet. Standard SMS charges from your mobile operator may apply.',
      ),
      buttonPositive: tStatic('Allow'),
      buttonNegative: tStatic('Not now'),
    });
    return result === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
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
  if (!isDirectSmsSupported() || !send || recipients.length === 0) {
    return { sent: [], failed: [...recipients], error: 'Silent SMS is not available on this phone' };
  }

  const granted = (await hasSmsPermission()) || (await requestSmsPermission());
  if (!granted) return { sent: [], failed: [...recipients], error: 'SMS permission not granted' };

  const results = await Promise.allSettled(recipients.map((n) => send(n, message)));
  const out: DirectSmsResult = { sent: [], failed: [] };
  results.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value === 'sent') {
      out.sent.push(recipients[i]);
    } else {
      out.failed.push(recipients[i]);
      if (!out.error) {
        const reason = r.status === 'rejected' ? (r.reason as Error)?.message : String(r.value);
        out.error = reason || 'SMS failed';
      }
    }
  });
  return out;
}
