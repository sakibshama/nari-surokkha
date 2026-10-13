/**
 * When an SOS went out only by SMS (no internet), the full online SOS — live
 * tracking, responders, the server's own SMS — should follow by itself once
 * the connection returns. This decides when. Pure, so it is unit tested.
 */

/** An offline SOS older than this is not escalated: the situation has moved on. */
export const ESCALATION_WINDOW_MS = 30 * 60 * 1000;

export interface PendingOfflineSos {
  /** When the offline SOS was sent (epoch ms). */
  at: number;
  coords: { latitude: number; longitude: number } | null;
  /** Set once the online SOS was attempted, so it is created at most once. */
  escalated?: boolean;
}

export interface EscalationState {
  now: number;
  online: boolean;
  authenticated: boolean;
  /** An online SOS is already live — nothing to do. */
  sosActive: boolean;
}

export type EscalationDecision =
  | { action: 'escalate' }
  | { action: 'wait' }
  | { action: 'discard'; reason: 'none' | 'done' | 'expired' | 'sos_active' };

export function decideEscalation(p: PendingOfflineSos | null, s: EscalationState): EscalationDecision {
  if (!p) return { action: 'discard', reason: 'none' };
  if (p.escalated) return { action: 'discard', reason: 'done' };
  if (s.now - p.at > ESCALATION_WINDOW_MS || s.now < p.at) return { action: 'discard', reason: 'expired' };
  if (s.sosActive) return { action: 'discard', reason: 'sos_active' };
  if (!s.online || !s.authenticated) return { action: 'wait' };
  return { action: 'escalate' };
}
