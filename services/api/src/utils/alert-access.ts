/**
 * Who may see an alert's live data (room, evidence): its owner, an admin, or a
 * responder whose dispatch for that alert was ACCEPTED. A merely-dispatched
 * responder only gets the masked summary from /responders/dispatches.
 */

import type { PrismaClient } from '@prisma/client';

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
        where: { acceptedAt: { not: null }, responder: { userId: user.id } },
        select: { id: true },
        take: 1,
      },
    },
  });
  if (!alert) return false;
  return alert.userId === user.id || alert.responderDispatches.length > 0;
}
