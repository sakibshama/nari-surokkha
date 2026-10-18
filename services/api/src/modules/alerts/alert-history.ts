/**
 * Alert status history — the permanent record of every SOS.
 *
 * Every status change of an EmergencyAlert (creation, soft-alert cancel /
 * confirm, auto-escalation, owner cancel / resolve, admin updates) appends a
 * row to alert_status_events. Rows are never updated or deleted, and the FK
 * is RESTRICT, so the admin portal can always show the full timeline of an
 * alert whatever happened to it afterwards.
 *
 * Writing history must never stop an SOS. The event is written in the same
 * transaction as the status change; if (and only if) the HISTORY insert fails
 * (e.g. the migration is not applied yet), the status change is retried on
 * its own and the failure is logged.
 */

import type { AlertStatus, EmergencyAlert, Prisma, PrismaClient } from '@prisma/client';

export type AlertActorKind = 'user' | 'admin' | 'system';

/** Who / why, as recorded with a status change. */
export interface AlertStatusActor {
  actorKind: AlertActorKind;
  actorId?: string | null;
  reason?: string | null;
  metadata?: Prisma.InputJsonValue;
}

export interface AlertStatusChange extends AlertStatusActor {
  alertId: string;
  fromStatus: AlertStatus | null;
  toStatus: AlertStatus;
}

export interface HistoryLogger {
  error: (obj: unknown, msg?: string) => void;
}

type Db = PrismaClient | Prisma.TransactionClient;

/** Raised inside the transaction when only the history insert failed. */
class HistoryWriteError extends Error {
  constructor(readonly inner: unknown) {
    super('alert status history write failed');
  }
}

const REASON_MAX = 2000;

export function statusEventData(change: AlertStatusChange): Prisma.AlertStatusEventUncheckedCreateInput {
  return {
    alertId: change.alertId,
    fromStatus: change.fromStatus,
    toStatus: change.toStatus,
    actorKind: change.actorKind,
    actorId: change.actorId ?? null,
    reason: change.reason ? change.reason.slice(0, REASON_MAX) : null,
    ...(change.metadata !== undefined ? { metadata: change.metadata } : {}),
  };
}

/** Best-effort standalone write (used where no status update accompanies it). */
export async function recordAlertStatusEvent(
  db: Db,
  change: AlertStatusChange,
  log?: HistoryLogger,
): Promise<boolean> {
  try {
    await db.alertStatusEvent.create({ data: statusEventData(change) });
    return true;
  } catch (err) {
    log?.error({ err, alertId: change.alertId, toStatus: change.toStatus }, 'Failed to record alert status history');
    return false;
  }
}

/**
 * Run a status change and append its history row atomically.
 *
 * `apply` performs the update with the client it is given and returns the
 * updated alert, or null when nothing changed (a lost conditional race) — in
 * which case no history is written. `event` builds the history row from the
 * updated alert.
 */
export async function applyStatusTransition(
  db: PrismaClient,
  log: HistoryLogger | undefined,
  apply: (tx: Db) => Promise<EmergencyAlert | null>,
  event: (updated: EmergencyAlert) => AlertStatusChange,
): Promise<EmergencyAlert | null> {
  try {
    return await db.$transaction(async (tx) => {
      const updated = await apply(tx);
      if (!updated) return null;
      try {
        await tx.alertStatusEvent.create({ data: statusEventData(event(updated)) });
      } catch (err) {
        throw new HistoryWriteError(err);
      }
      return updated;
    });
  } catch (err) {
    if (!(err instanceof HistoryWriteError)) throw err;
    // The transaction rolled back the status change with it. Apply the change
    // without history rather than lose it.
    log?.error({ err: err.inner }, 'Alert status history write failed — applying the status change without it');
    return apply(db);
  }
}
