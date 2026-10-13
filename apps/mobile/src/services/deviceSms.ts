/**
 * SOS SMS from the phone's own SIM when the SERVER will not send it.
 *
 * The server sends the trusted-contact SMS while the user's plan has SMS
 * quota. When the quota is used up (or there is no active plan, or the server
 * could not queue the SMS) the SOS response says `smsViaDevice: true` and
 * carries `deviceSmsMessage` — the same admin template with a live tracking
 * link. This module sends it, in this order:
 *
 *   1. silently from the SIM (Android with SEND_SMS)            → done
 *   2. the Messages composer, only if the app is on screen      → user taps Send
 *   3. ask the server to send it after all (POST /sms-fallback) → done
 *
 * Step 3 means an SOS is never left un-texted just because the phone could
 * not send it (no permission, iOS in the background, app not visible).
 */

import { AppState } from 'react-native';
import * as SMS from 'expo-sms';
import api from './api';
import { trySendDirectSms } from './directSms';
import { getCachedContactPhones } from './offlineSos';
import { logSms } from './smsHistory';

export type DeviceSmsOutcome = 'sim' | 'composer' | 'server' | 'failed';

export interface DeviceSmsRequest {
  alertId: string;
  /** From the server response; falls back to the cached trusted contacts. */
  contactPhones?: string[];
  message: string;
  /** Allow opening the Messages composer (only meaningful while the app is visible). */
  allowComposer?: boolean;
}

const REASON = 'SMS limit reached — sent from your SIM';

async function askServer(alertId: string, recipients: string[], message: string): Promise<DeviceSmsOutcome> {
  try {
    await api.post(`/alerts/${alertId}/sms-fallback`);
    await logSms({
      channel: 'online-server',
      status: 'sent',
      recipients,
      message,
      reason: 'This phone could not send the SMS, so the server sent it',
    });
    return 'server';
  } catch (e) {
    await logSms({
      channel: 'quota-sim',
      status: 'failed',
      recipients,
      message,
      reason: (e as Error)?.message || 'Could not send the SMS from this phone or the server',
    });
    return 'failed';
  }
}

export async function sendSosSmsFromDevice(req: DeviceSmsRequest): Promise<DeviceSmsOutcome> {
  const recipients = req.contactPhones?.length ? req.contactPhones : await getCachedContactPhones();
  if (!recipients.length) {
    // Nobody to text from the phone; the server knows the contacts (if any).
    return askServer(req.alertId, recipients, req.message);
  }

  // 1. Silent send from the SIM — counted only once the network accepted it.
  const direct = await trySendDirectSms(recipients, req.message);
  if (direct.sent.length) {
    await logSms({ channel: 'quota-sim', status: 'auto', recipients: direct.sent, message: req.message, reason: REASON });
  }
  if (direct.failed.length === 0) return 'sim';
  const rest = direct.failed;

  // 2. Composer for whoever was not texted — only when the user is looking at the app.
  const visible = AppState.currentState === 'active';
  if ((req.allowComposer ?? visible) && visible) {
    try {
      if (await SMS.isAvailableAsync()) {
        const { result } = await SMS.sendSMSAsync(rest, req.message);
        if (result !== 'cancelled') {
          await logSms({ channel: 'quota-sim', status: 'manual', recipients: rest, message: req.message, reason: REASON });
          return 'composer';
        }
      }
    } catch {
      /* fall through to the server */
    }
  }

  // 3. The phone could not send it: the server sends it after all.
  const viaServer = await askServer(req.alertId, rest, req.message);
  return viaServer === 'failed' && direct.sent.length ? 'sim' : viaServer;
}
