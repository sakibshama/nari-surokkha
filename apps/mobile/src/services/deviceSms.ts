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
 *   2. ask the server to send it after all (POST /sms-fallback) → done
 *
 * Step 2 means an SOS is never left un-texted just because the phone could
 * not send it (no permission, iOS in the background, app not visible).
 */

import api from './api';
import { trySendDirectSms } from './directSms';
import { getCachedContactPhones } from './offlineSos';
import { logSms } from './smsHistory';
import { firstLink, simSosText, type SosCoords } from './sosText';

export type DeviceSmsOutcome = 'sim' | 'server' | 'failed';

export interface DeviceSmsRequest {
  alertId: string;
  /** From the server response; falls back to the cached trusted contacts. */
  contactPhones?: string[];
  /** The server's text; only its live-tracking link is reused (see below). */
  message: string;
  userName?: string;
  coords?: SosCoords | null;
  /** @deprecated The Messages composer is never opened any more. */
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

  // One single-part SMS per contact: the server's template (often Bangla,
  // with two links) would split into 2–3 parts that many phones show as
  // separate messages. Keep its live-tracking link, drop the rest.
  const message = simSosText(req.userName, req.coords ?? null, firstLink(req.message));

  // 1. Silent send from the SIM — counted only once the network accepted it.
  const direct = await trySendDirectSms(recipients, message);
  if (direct.sent.length) {
    await logSms({ channel: 'quota-sim', status: 'auto', recipients: direct.sent, message, reason: REASON });
  }
  if (direct.failed.length === 0) return 'sim';

  // 2. The phone could not text everyone: the server sends to them instead.
  //    (Never the Messages composer: the SOS must not need a tap, and opening
  //    it after a silent send is what produced duplicate texts.)
  const viaServer = await askServer(req.alertId, direct.failed, message);
  return viaServer === 'failed' && direct.sent.length ? 'sim' : viaServer;
}
