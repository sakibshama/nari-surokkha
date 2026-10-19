/**
 * Responder dispatch logic shared by the Responder Hub, the app-wide dispatch
 * listener and the push handler. Pure (no React Native imports) so it can be
 * unit tested with node:test.
 *
 * Server contract (services/api/src/modules/responder):
 *   GET   /responders/dispatches                      → { data: Dispatch[] }
 *   PATCH /responders/dispatches/:id/response
 *         { action: 'accept'|'reject'|'arrive'|'complete'|'withdraw', rejectReason? }
 *                                                     → { message, data: Dispatch }
 *         409 error.code: DISPATCH_STATE | SOS_ENDED | OWN_ALERT
 *   socket (user room)  'responder:dispatch_received' { dispatchId, alertId, alertUserId, ... }
 *                       'responder:dispatch_closed'   { dispatchId, alertId, status: 'closed', alertStatus }
 *   socket (alert room) 'responder:dispatch_update'   { alertId, dispatchId, responderId, status }
 *   GET   /alerts/:id/responders                      → { data: AlertResponder[] } (the victim's view)
 */

export type DispatchStatus =
  | 'pending'
  | 'accepted'
  | 'arrived'
  | 'completed'
  | 'declined'
  | 'withdrawn'
  | 'closed';

export type DispatchAction = 'accept' | 'reject' | 'arrive' | 'complete' | 'withdraw';

export interface Dispatch {
  id: string;
  alertId: string;
  status: DispatchStatus;
  dispatchedAt: string;
  acceptedAt?: string | null;
  arrivedAt?: string | null;
  completedAt?: string | null;
  closedAt?: string | null;
  distanceMeters?: number | null;
  alert: {
    id: string;
    userId?: string;
    status?: string;
    precise?: boolean;
    latitude: number;
    longitude: number;
    victimName?: string | null;
    victimPhone?: string | null;
    bloodGroup?: string | null;
  };
}

export interface AlertResponder {
  dispatchId: string;
  responderId: string;
  status: 'accepted' | 'arrived' | 'completed';
  name: string | null;
  phone: string | null;
  organizationName?: string | null;
  distanceMeters?: number | null;
  acceptedAt?: string | null;
  arrivedAt?: string | null;
}

/** Who is looking: used to make sure nobody is ever asked to help themselves. */
export interface ViewerContext {
  userId?: string | null;
  /** The viewer's own SOS in progress, if any. */
  activeAlertId?: string | null;
}

/** Dispatches the responder still has to act on. */
export const ACTIVE_DISPATCH_STATUSES: DispatchStatus[] = ['pending', 'accepted', 'arrived'];

/**
 * Defensive client-side check (the server already excludes the owner): is
 * this dispatch / event / push about the viewer's OWN SOS?
 */
export function isOwnSos(
  item: { alertId?: string; alertUserId?: string; alert?: { id?: string; userId?: string } } | null | undefined,
  viewer: ViewerContext,
): boolean {
  if (!item) return false;
  const ownerId = item.alertUserId ?? item.alert?.userId;
  if (viewer.userId && ownerId && ownerId === viewer.userId) return true;
  const alertId = item.alertId ?? item.alert?.id;
  return !!viewer.activeAlertId && !!alertId && alertId === viewer.activeAlertId;
}

/** The actions a responder may take in each state — mirrors the server. */
export function actionsFor(status: DispatchStatus): DispatchAction[] {
  switch (status) {
    case 'pending':
      return ['accept', 'reject'];
    case 'accepted':
      return ['arrive', 'complete', 'withdraw'];
    case 'arrived':
      return ['complete', 'withdraw'];
    default:
      return [];
  }
}

/** Split the list for the hub: what needs action now vs. history. Own SOS dropped. */
export function partitionDispatches(
  list: Dispatch[] | null | undefined,
  viewer: ViewerContext,
): { active: Dispatch[]; past: Dispatch[] } {
  const active: Dispatch[] = [];
  const past: Dispatch[] = [];
  for (const d of Array.isArray(list) ? list : []) {
    if (!d || !d.id || isOwnSos(d, viewer)) continue;
    (ACTIVE_DISPATCH_STATUSES.includes(d.status) ? active : past).push(d);
  }
  // Pending first (they need a decision), then the ones being handled.
  const rank = (s: DispatchStatus) => (s === 'pending' ? 0 : 1);
  active.sort((a, b) => rank(a.status) - rank(b.status));
  return { active, past };
}

/** Replace one dispatch in the list with the server's updated copy. */
export function upsertDispatch(list: Dispatch[], updated: Dispatch | null | undefined): Dispatch[] {
  if (!updated?.id) return list;
  const i = list.findIndex((d) => d.id === updated.id);
  if (i === -1) return [updated, ...list];
  const next = list.slice();
  next[i] = updated;
  return next;
}

/** The SOS behind a dispatch ended: mark it (and any other for that alert) closed. */
export function closeDispatch(
  list: Dispatch[],
  msg: { dispatchId?: string; alertId?: string } | null | undefined,
): Dispatch[] {
  if (!msg) return list;
  return list.map((d) =>
    (msg.dispatchId && d.id === msg.dispatchId) || (msg.alertId && d.alertId === msg.alertId)
      ? ACTIVE_DISPATCH_STATUSES.includes(d.status)
        ? { ...d, status: 'closed' as const }
        : d
      : d,
  );
}

export type ActionOutcome =
  /** The SOS was cancelled / resolved: not an error, the card just closes. */
  | { kind: 'ended' }
  /** The dispatch changed underneath us (double tap, another device): refresh. */
  | { kind: 'stale'; message?: string }
  | { kind: 'own' }
  | { kind: 'not_responder' }
  | { kind: 'offline' }
  | { kind: 'error'; message?: string };

/** Map an axios-style error from the dispatch endpoints to what the UI should do. */
export function classifyDispatchError(err: unknown): ActionOutcome {
  const e = err as { response?: { status?: number; data?: { error?: { code?: string; message?: string } } } };
  const status = e?.response?.status;
  const code = e?.response?.data?.error?.code;
  const message = e?.response?.data?.error?.message;
  if (!e?.response) return { kind: 'offline' };
  if (status === 409) {
    if (code === 'SOS_ENDED') return { kind: 'ended' };
    if (code === 'OWN_ALERT') return { kind: 'own' };
    return { kind: 'stale', message };
  }
  if (status === 404) return { kind: 'not_responder' };
  return { kind: 'error', message };
}

/** "350 m" / "1.2 km" — null when the distance is unknown. */
export function formatDistance(meters: number | null | undefined): string | null {
  if (meters === null || meters === undefined || !Number.isFinite(meters) || meters < 0) return null;
  if (meters < 1000) return `${Math.max(10, Math.round(meters / 10) * 10)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

/** Google Maps directions link for an accepted dispatch. */
export function directionsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}
