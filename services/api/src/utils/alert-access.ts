/**
 * Who may see an alert's live data (room, evidence): its owner, an admin, or a
 * responder whose dispatch for that alert is accepted / arrived / completed
 * (not one who withdrew). A merely-dispatched
 * responder only gets the masked summary from /responders/dispatches.
 */

import type { PrismaClient } from '@prisma/client';
import { VISIBLE_TO_VICTIM_STATUSES } from '@/modules/responder/dispatch-lifecycle';

export function isAdminRole(role: string): boolean {
  return role === 'admin' || role === 'superadmin';
}

export async function canAccessAlert(
  prisma: PrismaClient,
  alertId: string,
  user: { id: string; role: string },
): Promise<boolean> {
  if (isAdminRole(user.role)) return true;
  const alert = await prisma.emergencyAlert.findUnique({
    where: { id: alertId },
    select: {
      userId: true,
      responderDispatches: {
        // Accepted and still on it (or done) — a responder who withdrew, or
        // declined, no longer sees the live data.
        where: { status: { in: VISIBLE_TO_VICTIM_STATUSES }, responder: { userId: user.id } },
        select: { id: true },
        take: 1,
      },
    },
  });
  if (!alert) return false;
  return alert.userId === user.id || alert.responderDispatches.length > 0;
}
