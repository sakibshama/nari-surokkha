/**
 * Durable outbox for live-location pings.
 *
 * The background task posted each position with `api.post(...)` and, on
 * failure, logged the error in dev and moved on. In an emergency that is the
 * wrong behaviour twice over:
 *
 *  - Cellular coverage in the situations this app exists for is exactly where
 *    it is worst — a stairwell, a basement, a moving vehicle handing between
 *    towers. Those are the pings you most want to keep.
 *  - The gaps are silent. Nobody watching the tracking page can tell the
 *    difference between "she stopped moving" and "her phone lost signal", and
 *    those mean very different things.
 *
 * So failed pings are queued on the device and flushed when connectivity
 * returns. The server accepts a timestamp per point, so a late-delivered ping
 * still lands in the right place on the trail rather than pretending to be
 * current.
 *
 * Bounded on purpose: `MAX_QUEUED` points, oldest dropped first. An unbounded
 * queue on a phone that has been offline for hours is its own problem.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import api from './api';

const STORAGE_KEY = 'location_outbox_v1';
/** ~40 minutes of 10-second pings. Beyond that, the oldest are dropped. */
const MAX_QUEUED = 240;

export interface QueuedPing {
  alertId: string;
  latitude: number;
  longitude: number;
  accuracy?: number;
  /** When the fix was actually taken, not when it was sent. */
  timestamp: string;
}

async function read(): Promise<QueuedPing[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as QueuedPing[]) : [];
  } catch {
    return [];
  }
}

async function write(queue: QueuedPing[]): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(queue.slice(-MAX_QUEUED)));
  } catch {
    /* storage full or unavailable — nothing useful to do from here */
  }
}

/** Queue a ping that could not be delivered. */
export async function enqueue(ping: QueuedPing): Promise<void> {
  const queue = await read();
  queue.push(ping);
  await write(queue);
}

/** How many pings are waiting. Surfaced in the UI as "reconnecting…". */
export async function pendingCount(): Promise<number> {
  return (await read()).length;
}

/**
 * Send a ping, queueing it if the network is unavailable.
 * Returns true when it reached the server.
 */
export async function sendOrQueue(ping: QueuedPing): Promise<boolean> {
  try {
    await api.post(`/alerts/${ping.alertId}/location`, {
      latitude: ping.latitude,
      longitude: ping.longitude,
      accuracy: ping.accuracy,
      timestamp: ping.timestamp,
    });
    return true;
  } catch {
    await enqueue(ping);
    return false;
  }
}

/**
 * Attempt to deliver everything queued. Called after a successful ping — a
 * ping that gets through is the clearest signal that connectivity is back.
 *
 * Stops at the first failure and keeps the remainder, so a flaky connection
 * does not burn the whole backlog on retries that will also fail. Delivery is
 * in order, oldest first, so the trail reconstructs correctly.
 */
export async function flush(): Promise<{ sent: number; remaining: number }> {
  const queue = await read();
  if (queue.length === 0) return { sent: 0, remaining: 0 };

  let sent = 0;
  for (const ping of queue) {
    try {
      await api.post(`/alerts/${ping.alertId}/location`, {
        latitude: ping.latitude,
        longitude: ping.longitude,
        accuracy: ping.accuracy,
        timestamp: ping.timestamp,
      });
      sent++;
    } catch {
      break; // still offline — keep what is left for the next attempt
    }
  }

  const remaining = queue.slice(sent);
  await write(remaining);
  return { sent, remaining: remaining.length };
}

/** Drop everything. Called when the alert ends — a stale trail helps nobody. */
export async function clear(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    /* best-effort */
  }
}
