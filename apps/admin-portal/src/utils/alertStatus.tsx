/**
 * Shared SOS status vocabulary for the portal: labels, groups and the badge.
 * Labels are English source strings — pass them through `t()`.
 */
import { useT } from '../i18n';

// Contract 7: "active" = someone may still need help.
export const ACTIVE_ALERT_STATUSES = ['created', 'confirmed', 'notified_contacts', 'in_progress'];

export const ALERT_STATUS_LABEL: Record<string, string> = {
  created: 'New',
  confirmed: 'Confirmed',
  notified_contacts: 'Contacts notified',
  sent_to_police: 'Sent to police',
  acknowledged_by_police: 'Acknowledged by police',
  in_progress: 'In progress',
  resolved: 'Resolved',
  closed: 'Closed',
  false_alarm: 'False alarm',
  cancelled: 'Cancelled',
};

/** Filter choices on the SOS reports page: label → comma list sent to the API. */
export const ALERT_STATUS_FILTERS: { key: string; label: string; statuses: string }[] = [
  { key: 'all', label: 'All', statuses: '' },
  { key: 'active', label: 'Active', statuses: ACTIVE_ALERT_STATUSES.join(',') },
  { key: 'resolved', label: 'Resolved', statuses: 'resolved' },
  { key: 'cancelled', label: 'Cancelled / false alarm', statuses: 'cancelled,false_alarm' },
  { key: 'closed', label: 'Closed', statuses: 'closed' },
];

export const ALERT_TYPE_LABEL: Record<string, string> = {
  manual: 'Manual SOS',
  sensor_triggered: 'Sensor triggered',
  ml_triggered: 'Audio (ML) triggered',
};

export const ACTOR_LABEL: Record<string, string> = {
  user: 'User',
  admin: 'Admin',
  system: 'System',
};

function badgeClass(status: string): string {
  switch (status) {
    case 'created':
    case 'confirmed':
    case 'notified_contacts':
      return 'badge danger';
    case 'in_progress':
      return 'badge warning';
    case 'resolved':
      return 'badge success';
    case 'false_alarm':
    case 'cancelled':
      return 'badge info';
    default:
      return 'badge muted';
  }
}

export function AlertStatusBadge({ status }: { status: string }) {
  const t = useT();
  const active = ACTIVE_ALERT_STATUSES.includes(status);
  return (
    <span className={badgeClass(status)}>
      {active && <span className="badge-dot"></span>}
      {t(ALERT_STATUS_LABEL[status] ?? status.replace(/_/g, ' '))}
    </span>
  );
}

export function formatDateTime(d?: string | null): string {
  return d ? new Date(d).toLocaleString() : '—';
}
