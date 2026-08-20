/**
 * Expo Push provider.
 *
 * The mobile app registers Expo push tokens, so responder dispatch pushes go
 * through Expo's service rather than raw FCM.
 *
 * Two things this handles that a bare `fetch()` in a loop does not:
 *
 *  1. **Batching.** Expo accepts up to 100 messages per request. Sending one
 *     request per responder turned a 20-responder dispatch into 20 sequential
 *     HTTPS round trips on the SOS path.
 *  2. **Bounded failure.** Every call is wrapped in a timeout and never throws.
 *     A push is a best-effort side channel — the WebSocket dispatch and the SMS
 *     fan-out are the channels that must not fail, and neither should be held
 *     up (or aborted) because Expo is slow.
 */

const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';
const EXPO_MAX_BATCH = 100;
const EXPO_TIMEOUT_MS = 10_000;

export interface ExpoPushMessage {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: 'default' | null;
}

export interface ExpoPushResult {
  attempted: number;
  accepted: number;
  failed: number;
}

/** Split an array into chunks of at most `size`. */
function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** An Expo push token looks like ExponentPushToken[xxxxxxxx] or ExpoPushToken[…]. */
export function isExpoPushToken(token: string): boolean {
  return /^Expo(nent)?PushToken\[.+\]$/.test(token);
}

/**
 * Send one notification to many device tokens, in batches of 100.
 * Never throws — returns a per-call tally instead, so the caller can log it
 * without wrapping every send site in try/catch.
 */
export async function sendExpoPushBatch(
  tokens: string[],
  message: ExpoPushMessage,
  // Structurally compatible with Fastify's pino logger without importing it.
  log?: { warn: (...args: any[]) => void; info: (...args: any[]) => void },
): Promise<ExpoPushResult> {
  const valid = [...new Set(tokens.filter(isExpoPushToken))];
  const result: ExpoPushResult = { attempted: valid.length, accepted: 0, failed: 0 };
  if (valid.length === 0) return result;

  for (const batch of chunk(valid, EXPO_MAX_BATCH)) {
    const payload = batch.map((to) => ({
      to,
      sound: message.sound === null ? undefined : 'default',
      title: message.title,
      body: message.body,
      data: message.data,
      priority: 'high',
      channelId: 'emergency',
    }));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), EXPO_TIMEOUT_MS);
    try {
      const resp = await fetch(EXPO_PUSH_ENDPOINT, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Accept-encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!resp.ok) {
        result.failed += batch.length;
        log?.warn({ status: resp.status, count: batch.length }, 'Expo push batch rejected');
        continue;
      }

      // Expo replies with a per-message ticket: { data: [{ status, message? }] }
      const body = (await resp.json()) as { data?: Array<{ status?: string; message?: string }> };
      const tickets = body?.data ?? [];
      for (const ticket of tickets) {
        if (ticket?.status === 'ok') result.accepted++;
        else result.failed++;
      }
      // Defensive: if Expo returned no tickets, count the batch as accepted-unknown.
      if (tickets.length === 0) result.accepted += batch.length;
    } catch (err) {
      result.failed += batch.length;
      log?.warn({ err, count: batch.length }, 'Expo push batch failed');
    } finally {
      clearTimeout(timer);
    }
  }

  return result;
}
