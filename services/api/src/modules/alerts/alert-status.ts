/**
 * Alert status groups shared by the alert, admin and tracking code.
 * "Active" = someone may still need help.
 */

import type { AlertStatus } from '@prisma/client';

export const ACTIVE_ALERT_STATUSES: AlertStatus[] = ['created', 'confirmed', 'notified_contacts', 'in_progress'];

/** Statuses an admin may set from the portal. */
export const ADMIN_SETTABLE_STATUSES = ['in_progress', 'resolved', 'closed', 'false_alarm'] as const;
export type AdminSettableStatus = (typeof ADMIN_SETTABLE_STATUSES)[number];
