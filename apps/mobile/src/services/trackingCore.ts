/**
 * Who needs location tracking right now. The SOS and Safe Route share one OS
 * location task; each holds a reason, and the task stops only when no reason
 * is left (leaving Safe Route must never stop SOS tracking, and vice versa).
 * Pure, so it is unit tested.
 */
export type TrackingReason = 'sos' | 'route';

export class TrackingReasons {
  private readonly held = new Set<TrackingReason>();

  /** Returns true when this is the first reason (tracking must start). */
  add(reason: TrackingReason): boolean {
    const first = this.held.size === 0;
    this.held.add(reason);
    return first;
  }

  /** Returns true when the last reason was removed (tracking must stop). */
  remove(reason: TrackingReason): boolean {
    if (!this.held.delete(reason)) return false;
    return this.held.size === 0;
  }

  has(reason: TrackingReason): boolean {
    return this.held.has(reason);
  }

  get size(): number {
    return this.held.size;
  }
}
