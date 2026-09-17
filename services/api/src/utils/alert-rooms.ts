/**
 * Socket.IO room targeting for alert events.
 *
 * `io.emit(...)` sends to EVERY connected socket on EVERY API instance. Two
 * call sites were doing that for alert-scoped events (evidence uploads and
 * responder acceptances), which meant:
 *
 *   - Privacy: every citizen using the app learned that evidence had been
 *     uploaded for alert X. On a women's-safety platform that is a real leak,
 *     not a theoretical one.
 *   - Cost: with 5,000 connected clients, one evidence upload fanned out to
 *     5,000 frames through the Redis adapter.
 *
 * The rooms already exist and are already authorised on join (see
 * plugins/websocket.ts). This helper just makes it hard to forget them.
 */

import type { FastifyInstance } from 'fastify';

/** The global admin room — every admin sees every alert event. */
export const ADMIN_ROOM = 'admin:global';

/**
 * Everyone entitled to see an event about a given alert: the alert's own room
 * (its owner and assigned responders) and the admin view. Never the whole server.
 */
export function alertRooms(alertId: string): string[] {
  return [`alert:${alertId}`, ADMIN_ROOM];
}

/**
 * Emit an alert-scoped event to exactly the rooms that should receive it.
 * No-ops safely when Socket.IO is not initialised.
 */
export function emitToAlert(
  fastify: FastifyInstance,
  alertId: string,
  event: string,
  payload: unknown,
): void {
  if (!fastify.io) {
    fastify.log.warn({ event, alertId }, 'WebSocket not initialized; skipping emit');
    return;
  }
  fastify.io.to(alertRooms(alertId)).emit(event, payload);
}
