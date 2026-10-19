/**
 * Responder dispatch lifecycle — the single source of truth for which action
 * moves a dispatch from which status to which, and for closing every open
 * dispatch when an SOS ends.
 *
 *   pending  ─accept→ accepted ─arrive→ arrived ─complete→ completed
 *      │                 │  └────────complete──────────────↗
 *      │                 └─withdraw→ withdrawn   (arrived ─withdraw→ withdrawn)
 *      └─reject→ declined
 *   pending | accepted | arrived ──(SOS cancelled / resolved / closed)──→ closed
 *
 * Every transition is a conditional `UPDATE ... WHERE id = ? AND status IN
 * (<allowed from>)`, so two concurrent requests can never both win: the loser
 * updates zero rows and gets a 409.
 *
 * Several responders may accept the same SOS (more help is better); one
 * responder can only accept their own dispatch once.
 */

import type { DispatchStatus, Prisma, PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';

export type DispatchAction = 'accept' | 'reject' | 'arrive' | 'complete' | 'withdraw';

export const DISPATCH_ACTIONS: DispatchAction[] = ['accept', 'reject', 'arrive', 'complete', 'withdraw'];

/** Still waiting on, or being handled by, the responder. */
export const OPEN_DISPATCH_STATUSES: DispatchStatus[] = ['pending', 'accepted', 'arrived'];

/** The responder has committed to helping (they are busy with this SOS). */
export const ENGAGED_DISPATCH_STATUSES: DispatchStatus[] = ['accepted', 'arrived'];

/** What the victim's SOS screen lists: responders who said yes. */
export const VISIBLE_TO_VICTIM_STATUSES: DispatchStatus[] = ['accepted', 'arrived', 'completed'];

/** Precise location / victim identity are revealed only in these states. */
export const UNMASKED_DISPATCH_STATUSES: DispatchStatus[] = ['accepted', 'arrived', 'completed'];

interface Transition {
  from: DispatchStatus[];
  to: DispatchStatus;
  stamp: 'acceptedAt' | 'rejectedAt' | 'arrivedAt' | 'completedAt' | 'withdrawnAt';
}

export const DISPATCH_TRANSITIONS: Record<DispatchAction, Transition> = {
  accept: { from: ['pending'], to: 'accepted', stamp: 'acceptedAt' },
  reject: { from: ['pending'], to: 'declined', stamp: 'rejectedAt' },
  arrive: { from: ['accepted'], to: 'arrived', stamp: 'arrivedAt' },
  complete: { from: ['accepted', 'arrived'], to: 'completed', stamp: 'completedAt' },
  withdraw: { from: ['accepted', 'arrived'], to: 'withdrawn', stamp: 'withdrawnAt' },
};

/**
 * Effective status of a dispatch: an open dispatch whose SOS has ended is
 * closed, even if the close sweep has not reached it yet (e.g. a fan-out that
 * raced the cancel).
 */
export function effectiveDispatchStatus(
  status: DispatchStatus,
  alertActive: boolean,
): DispatchStatus {
  if (!alertActive && OPEN_DISPATCH_STATUSES.includes(status)) return 'closed';
  return status;
}

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Put a responder back on duty once they have no other engaged dispatch.
 * Only flips `busy` → `available`: a responder who went offline stays offline.
 */
export async function freeResponderIfIdle(db: Db, responderId: string): Promise<void> {
  await db.responder.updateMany({
    where: {
      id: responderId,
      availability: 'busy',
      dispatchedAlerts: { none: { status: { in: ENGAGED_DISPATCH_STATUSES } } },
    },
    data: { availability: 'available' },
  });
}

/**
 * The SOS ended (owner cancelled / resolved it, or an admin closed it): close
 * every dispatch still open for it, free the responders who were on it, and
 * tell each responder's app so the card disappears.
 *
 * Best-effort by design: ending an SOS must never fail because of this. Any
 * dispatch it misses is still reported as closed by effectiveDispatchStatus().
 */
export async function closeDispatchesForAlert(
  fastify: FastifyInstance,
  alertId: string,
  alertStatus: string,
): Promise<number> {
  try {
    const open = await fastify.prisma.responderDispatch.findMany({
      where: { alertId, status: { in: OPEN_DISPATCH_STATUSES } },
      select: { id: true, responderId: true, status: true, responder: { select: { userId: true } } },
    });
    if (open.length === 0) return 0;

    const now = new Date();
    await fastify.prisma.responderDispatch.updateMany({
      where: { id: { in: open.map((d) => d.id) }, status: { in: OPEN_DISPATCH_STATUSES } },
      data: { status: 'closed', closedAt: now },
    });

    const engaged = open.filter((d) => ENGAGED_DISPATCH_STATUSES.includes(d.status));
    for (const d of engaged) {
      await freeResponderIfIdle(fastify.prisma, d.responderId);
    }

    if (fastify.io) {
      for (const d of open) {
        fastify.io.to(`user:${d.responder.userId}`).emit('responder:dispatch_closed', {
          dispatchId: d.id,
          alertId,
          status: 'closed',
          alertStatus,
          timestamp: now.toISOString(),
        });
      }
    }
    return open.length;
  } catch (err) {
    fastify.log.error(
      { err, alertId },
      'Failed to close responder dispatches for an ended SOS',
    );
    return 0;
  }
}
