/**
 * Sending one emergency text to several contacts from the SIM, safely.
 *
 * Firing every SMS at once (the old Promise.all) is what made the fallback
 * fight with the phone: dozens of multipart messages queued in the radio at
 * the same moment, Android's SMS rate monitor could stop the app with a
 * "this app is sending a large number of messages" dialog, and one slow
 * carrier answer held every other contact hostage. Here the numbers are
 * cleaned and de-duplicated, then texted one after another with a short gap.
 *
 * Pure (no react-native imports) so it is unit tested.
 */

export interface SequentialSmsResult {
  sent: string[];
  failed: string[];
  error?: string;
}

/** Contacts are capped: the SOS goes to the people who matter, not a broadcast. */
export const MAX_SMS_RECIPIENTS = 10;
/** Pause between two recipients, so the radio finishes one before the next. */
export const SMS_GAP_MS = 750;

/** Strip spaces/dashes/brackets; keep a leading +. Empty for nonsense. */
export function normalizePhone(raw: string): string {
  const trimmed = (raw ?? '').trim();
  const plus = trimmed.startsWith('+') ? '+' : '';
  const digits = trimmed.replace(/\D/g, '');
  return digits.length >= 3 ? plus + digits : '';
}

/** Cleaned, de-duplicated, capped list in the original order. */
export function prepareRecipients(recipients: string[], max = MAX_SMS_RECIPIENTS): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of recipients) {
    const n = normalizePhone(r);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
    if (out.length >= max) break;
  }
  return out;
}

export async function sendSequentially(
  recipients: string[],
  sendOne: (phone: string) => Promise<unknown>,
  opts: { gapMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<SequentialSmsResult> {
  const gap = opts.gapMs ?? SMS_GAP_MS;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const out: SequentialSmsResult = { sent: [], failed: [] };
  for (let i = 0; i < recipients.length; i++) {
    if (i > 0 && gap > 0) await sleep(gap);
    const phone = recipients[i];
    try {
      const value = await sendOne(phone);
      if (value === 'sent') out.sent.push(phone);
      else {
        out.failed.push(phone);
        out.error ??= String(value || 'SMS failed');
      }
    } catch (e) {
      out.failed.push(phone);
      out.error ??= (e as Error)?.message || 'SMS failed';
    }
  }
  return out;
}
