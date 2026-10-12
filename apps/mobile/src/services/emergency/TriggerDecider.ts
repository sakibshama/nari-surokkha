/**
 * Turns noisy per-frame model scores into discrete detections.
 *
 * Rule per trigger: fire when ≥ `hits` of the last `window` scores reach the
 * threshold for the chosen sensitivity, then stay quiet for the refractory
 * period so one shout (or one "help help help") is one event.
 */

import {
  Sensitivity,
  TRIGGER_REFRACTORY_MS,
  TRIGGER_RULES,
  TriggerId,
  TRIGGERS,
} from './constants';

export interface TriggerConfig {
  enabled: boolean;
  sensitivity: Sensitivity;
}

export interface Detection {
  trigger: TriggerId;
  /** Highest score inside the window that fired. */
  confidence: number;
  at: number;
}

export class TriggerDecider {
  private readonly recent: Record<TriggerId, number[]> = { shout: [], help: [], cry: [], bachao: [] };
  private readonly lastFired: Record<TriggerId, number> = { shout: -Infinity, help: -Infinity, cry: -Infinity, bachao: -Infinity };

  constructor(
    private config: Record<TriggerId, TriggerConfig>,
    private readonly refractoryMs = TRIGGER_REFRACTORY_MS,
  ) {}

  setConfig(config: Record<TriggerId, TriggerConfig>): void {
    this.config = config;
  }

  reset(): void {
    for (const t of TRIGGERS) {
      this.recent[t] = [];
      this.lastFired[t] = -Infinity;
    }
  }

  /** Feed one score for one trigger. Returns a detection if the rule fires. */
  push(trigger: TriggerId, score: number, now: number): Detection | null {
    const cfg = this.config[trigger];
    const rule = TRIGGER_RULES[trigger][cfg?.sensitivity ?? 'medium'];
    const buf = this.recent[trigger];
    buf.push(score);
    while (buf.length > rule.window) buf.shift();

    if (!cfg?.enabled) return null;
    if (now - this.lastFired[trigger] < this.refractoryMs) return null;

    let hits = 0;
    let best = 0;
    for (const s of buf) {
      if (s >= rule.threshold) hits++;
      if (s > best) best = s;
    }
    if (hits < rule.hits) return null;

    this.lastFired[trigger] = now;
    buf.length = 0;
    return { trigger, confidence: best, at: now };
  }
}
