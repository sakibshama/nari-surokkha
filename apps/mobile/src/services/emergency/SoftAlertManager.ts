/**
 * SoftAlertManager — owns the 15-second soft alert, whoever raised it
 * (a sound detection, the motion model, or the user's "silent alert" button).
 *
 *   trigger()  ── duplicate / cooldown / active-SOS checks
 *      │
 *      ├─ countdown starts (vibration + notification), server soft alert is
 *      │  created in parallel with the current location
 *      │
 *      ├─ cancel()      "I'm okay"      → server alert cancelled, cooldown starts
 *      ├─ confirmNow()  "I need help"   → SOS
 *      └─ deadline      no answer       → SOS
 *
 * SOS = confirm the server soft alert; if there is none, create an SOS
 * directly; if the server cannot be reached at all, text the trusted contacts
 * from the phone (offline SMS). Every outcome is written to the history.
 *
 * The server also escalates an unanswered soft alert on its own after 30 s,
 * so a phone that dies mid-countdown still raises the alarm.
 *
 * All side effects are injected (see SoftAlertDeps) so the logic is unit
 * tested without a phone.
 */

import { SOFT_ALERT_SECONDS } from './constants';
import type { AlertHistoryEntry, AlertOutcome, AlertSource } from './alertHistory';

export interface Coords {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
}

export interface ConfirmResult {
  alertId: string;
  trackingToken?: string;
  contactPhones?: string[];
  degradedNotifications?: boolean;
  /** Server will not send the contact SMS (quota used up): the phone must. */
  smsViaDevice?: boolean;
  deviceSmsMessage?: string;
}

/** Thrown by the API deps when the server could not be reached at all. */
export class NetworkUnavailableError extends Error {
  constructor(message = 'Server unreachable') {
    super(message);
    this.name = 'NetworkUnavailableError';
  }
}

export interface SoftAlertDeps {
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  getLocation(): Promise<Coords | null>;
  api: {
    createSoftAlert(c: Coords, meta: Record<string, unknown>): Promise<string>;
    cancelSoftAlert(alertId: string): Promise<void>;
    confirmSoftAlert(alertId: string): Promise<ConfirmResult>;
    createSos(c: Coords): Promise<ConfirmResult>;
  };
  /** Phone-side SMS to trusted contacts. Returns true when it went out (or the composer opened). */
  sendOfflineSms(c: Coords | null): Promise<boolean>;
  /** Server confirmed but will not text the contacts (SMS quota used up, or queue down) — text them from the phone's SIM. */
  sendFallbackSms(result: ConfirmResult, c: Coords | null): Promise<void>;
  isSosActive(): boolean;
  /** Called once the SOS is live (navigate, start tracking, etc.). */
  onSosActivated(result: ConfirmResult, viaOffline: boolean): void;
  history: {
    add(e: AlertHistoryEntry): void;
    update(id: string, patch: Partial<AlertHistoryEntry>): void;
  };
  feedback: {
    start(a: ActiveSoftAlert): void; // vibration + notification
    stop(a: ActiveSoftAlert, outcome: AlertOutcome): void;
  };
  isBackground(): boolean;
  cooldownMs(): number;
  /** Optional per-source hooks (e.g. motion training samples). */
  onCancelled?(source: AlertSource): void;
  onConfirmed?(source: AlertSource): void;
}

export type SoftAlertPhase = 'counting' | 'sending' | 'sent' | 'cancelled' | 'failed';

export interface ActiveSoftAlert {
  id: string;
  source: AlertSource;
  confidence?: number;
  startedAt: number;
  deadline: number;
  phase: SoftAlertPhase;
  background: boolean;
  duplicates: number;
  serverAlertId?: string;
  result?: ConfirmResult;
  viaOffline?: boolean;
  error?: string;
}

export type TriggerResult =
  | { accepted: true; alert: ActiveSoftAlert }
  | { accepted: false; reason: 'active' | 'cooldown' | 'sos_active' };

const SERVER_CREATE_WAIT_MS = 8000;

let seq = 0;
const newId = (now: number) => `sa_${now.toString(36)}_${(seq++).toString(36)}`;

export class SoftAlertManager {
  private current: ActiveSoftAlert | null = null;
  private listeners = new Set<(a: ActiveSoftAlert | null) => void>();
  private timer: unknown = null;
  private creation: Promise<string | null> | null = null;
  private coords: Coords | null = null;
  private cooldownUntil = 0;
  private lastSuppressed: { id: string; source: AlertSource; reason: string; at: number; count: number } | null = null;

  constructor(private readonly deps: SoftAlertDeps) {}

  get active(): ActiveSoftAlert | null {
    return this.current;
  }

  subscribe(cb: (a: ActiveSoftAlert | null) => void): () => void {
    this.listeners.add(cb);
    cb(this.current);
    return () => this.listeners.delete(cb);
  }

  private publish(): void {
    const snap = this.current ? { ...this.current } : null;
    this.listeners.forEach((l) => l(snap));
  }

  /** Milliseconds left on the countdown (0 when not counting). */
  remainingMs(): number {
    if (!this.current || this.current.phase !== 'counting') return 0;
    return Math.max(0, this.current.deadline - this.deps.now());
  }

  /**
   * Raise a soft alert. `manual` alerts (the user's own silent-alert button)
   * ignore the cooldown — the user is asking for it.
   */
  trigger(source: AlertSource, opts: { confidence?: number; manual?: boolean } = {}): TriggerResult {
    const now = this.deps.now();
    const manual = opts.manual ?? source === 'manual';

    if (this.deps.isSosActive()) return this.suppress(source, 'sos_active', now);

    if (this.current && (this.current.phase === 'counting' || this.current.phase === 'sending')) {
      this.current.duplicates++;
      this.deps.history.update(this.current.id, { duplicates: this.current.duplicates });
      return { accepted: false, reason: 'active' };
    }
    if (!manual && now < this.cooldownUntil) return this.suppress(source, 'cooldown', now);

    const alert: ActiveSoftAlert = {
      id: newId(now),
      source,
      confidence: opts.confidence,
      startedAt: now,
      deadline: now + SOFT_ALERT_SECONDS * 1000,
      phase: 'counting',
      background: this.deps.isBackground(),
      duplicates: 0,
    };
    this.current = alert;
    this.coords = null;
    this.deps.history.add({
      id: alert.id,
      source,
      confidence: opts.confidence,
      startedAt: now,
      outcome: 'pending',
      background: alert.background,
    });
    this.deps.feedback.start(alert);
    this.creation = this.createOnServer(alert);
    this.timer = this.deps.setTimer(() => void this.confirm(alert.id, 'auto'), SOFT_ALERT_SECONDS * 1000);
    this.publish();
    return { accepted: true, alert };
  }

  private suppress(source: AlertSource, reason: 'cooldown' | 'sos_active', now: number): TriggerResult {
    // Merge bursts of the same suppressed trigger into one history row.
    const last = this.lastSuppressed;
    if (last && last.source === source && last.reason === reason && now - last.at < 60_000) {
      last.count++;
      last.at = now;
      this.deps.history.update(last.id, { count: last.count, endedAt: now });
    } else {
      const id = newId(now);
      this.lastSuppressed = { id, source, reason, at: now, count: 1 };
      this.deps.history.add({
        id,
        source,
        startedAt: now,
        endedAt: now,
        outcome: 'suppressed',
        count: 1,
        detail: reason === 'cooldown' ? 'Cooldown after "I\'m okay"' : 'An SOS is already active',
      });
    }
    return { accepted: false, reason };
  }

  private async createOnServer(alert: ActiveSoftAlert): Promise<string | null> {
    try {
      const coords = await this.deps.getLocation();
      this.coords = coords;
      if (!coords) return null;
      const id = await this.deps.api.createSoftAlert(coords, {
        trigger: alert.source,
        confidence: alert.confidence,
        background: alert.background,
        detector: 'on-device-v1',
      });
      alert.serverAlertId = id;
      this.deps.history.update(alert.id, { alertId: id });
      // Cancelled while we were still creating it: cancel it now, or the
      // server's own 30 s escalation would turn it into a real SOS.
      if (alert.phase === 'cancelled') await this.deps.api.cancelSoftAlert(id).catch(() => {});
      return id;
    } catch {
      return null;
    }
  }

  /** "I'm okay". */
  async cancel(): Promise<void> {
    const a = this.current;
    if (!a || a.phase !== 'counting') return;
    a.phase = 'cancelled';
    this.clearTimer();
    const now = this.deps.now();
    this.cooldownUntil = now + this.deps.cooldownMs();
    this.deps.feedback.stop(a, 'cancelled');
    this.deps.history.update(a.id, { outcome: 'cancelled', endedAt: now });
    this.deps.onCancelled?.(a.source);
    this.publish();
    this.current = null;
    this.publish();
    // If the server alert is still being created, createOnServer() cancels it
    // as soon as it exists (it sees phase === 'cancelled').
    if (a.serverAlertId) await this.deps.api.cancelSoftAlert(a.serverAlertId).catch(() => {});
  }

  /** "I need help now". */
  confirmNow(): Promise<void> {
    return this.current ? this.confirm(this.current.id, 'user') : Promise.resolve();
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      this.deps.clearTimer(this.timer);
      this.timer = null;
    }
  }

  private async confirm(id: string, by: 'user' | 'auto'): Promise<void> {
    const a = this.current;
    if (!a || a.id !== id || a.phase !== 'counting') return;
    a.phase = 'sending';
    this.clearTimer();
    this.publish();

    const outcome: AlertOutcome = by === 'auto' ? 'auto_confirmed' : 'confirmed';
    let result: ConfirmResult | null = null;
    let offline = false;
    let error: string | undefined;

    try {
      const serverId = a.serverAlertId ?? (await this.withTimeout(this.creation, SERVER_CREATE_WAIT_MS));
      if (serverId) {
        result = await this.deps.api.confirmSoftAlert(serverId);
      } else {
        // No soft alert on the server (no fix yet, or offline). Try a direct SOS.
        const c = this.coords ?? (await this.deps.getLocation());
        this.coords = c;
        if (c) result = await this.deps.api.createSos(c);
        else error = 'No location fix';
      }
    } catch (e) {
      error = (e as Error)?.message ?? String(e);
      offline = e instanceof NetworkUnavailableError;
    }

    if (!result) {
      // Server path failed. Never leave the user with nothing: text contacts
      // from the phone, whatever the reason was.
      const sent = await this.deps.sendOfflineSms(this.coords).catch(() => false);
      if (sent) {
        offline = true;
        result = { alertId: '' };
      }
    } else if (result.smsViaDevice || result.degradedNotifications) {
      await this.deps.sendFallbackSms(result, this.coords).catch(() => {});
    }

    const now = this.deps.now();
    if (result) {
      a.phase = 'sent';
      a.result = result;
      a.viaOffline = offline;
      this.deps.feedback.stop(a, offline ? 'sent_offline' : outcome);
      this.deps.history.update(a.id, {
        outcome: offline ? 'sent_offline' : outcome,
        endedAt: now,
        alertId: result.alertId || a.serverAlertId,
        detail: offline ? error ?? 'Server unreachable' : undefined,
      });
      this.deps.onConfirmed?.(a.source);
      this.publish();
      this.deps.onSosActivated(result, offline);
    } else {
      a.phase = 'failed';
      a.error = error ?? 'Unknown error';
      this.deps.feedback.stop(a, 'failed');
      this.deps.history.update(a.id, { outcome: 'failed', endedAt: now, detail: a.error });
      this.publish();
    }
    this.current = a.phase === 'failed' ? a : null;
    if (!this.current) this.publish();
  }

  /** Dismiss a failed alert (the UI shows the failure until the user acknowledges it). */
  dismissFailure(): void {
    if (this.current?.phase === 'failed') {
      this.current = null;
      this.publish();
    }
  }

  private async withTimeout<T>(p: Promise<T> | null, ms: number): Promise<T | null> {
    if (!p) return null;
    let handle: unknown;
    const t = new Promise<null>((r) => {
      handle = this.deps.setTimer(() => r(null), ms);
    });
    const v = await Promise.race([p, t]);
    this.deps.clearTimer(handle);
    return v;
  }
}
