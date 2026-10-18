/**
 * Turns noisy per-frame model scores into discrete detections.
 *
 * Per trigger (k-of-n voting, the rule evaluated in
 * services/ml-training/keywords/REPORT.md):
 *   fire when ≥ `hits` of the last `window` scores reach the threshold for the
 *   chosen sensitivity.
 * Then:
 *   - refractory: quiet for TRIGGER_REFRACTORY_MS (one shout = one event);
 *   - hysteresis: re-armed only after the score has dropped below
 *     REARM_RATIO × threshold for a whole window (or after REARM_MAX_MS), so a
 *     long cry is one detection, not one every 8 s.
 *
 * Combined cues: a keyword cue (help/bachao) and a sound cue (shout/cry) that
 * each reach only their weaker rule, within COMBINE_WINDOW_MS of each other,
 * fire together. A single weak cue never fires.
 *
 * Scores arrive per trigger at their own rate (keywords every 80 ms, YAMNet
 * every 500 ms); each trigger keeps its own fixed-size ring of recent scores.
 */

import {
  COMBINE_WINDOW_MS,
  KEYWORD_TRIGGERS,
  REARM_MAX_MS,
  REARM_RATIO,
  Sensitivity,
  TRIGGER_REFRACTORY_MS,
  TRIGGER_RULES,
  TriggerId,
  TRIGGERS,
  WEAK_HITS,
  WEAK_THRESHOLD_RATIO,
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
  /** Set when two weaker cues fired together (e.g. ['help', 'shout']). */
  combined?: TriggerId[];
}

/** Longest rule window over all triggers and sensitivities. */
const MAX_WINDOW = Math.max(...TRIGGERS.flatMap((t) => Object.values(TRIGGER_RULES[t]).map((r) => r.window)));

interface TriggerState {
  ring: Float32Array;
  /** Number of scores written since the last clear (capped at MAX_WINDOW for reading). */
  count: number;
  pos: number;
  lastFired: number;
  armed: boolean;
  /** Consecutive scores below the re-arm level since firing. */
  quietRun: number;
  /** Last time this trigger reached its weak rule, and the best score then. */
  weakAt: number;
  weakScore: number;
}

const newState = (): TriggerState => ({
  ring: new Float32Array(MAX_WINDOW),
  count: 0,
  pos: 0,
  lastFired: -Infinity,
  armed: true,
  quietRun: 0,
  weakAt: -Infinity,
  weakScore: 0,
});

export class TriggerDecider {
  private readonly state: Record<TriggerId, TriggerState> = {
    shout: newState(),
    help: newState(),
    cry: newState(),
    bachao: newState(),
  };

  constructor(
    private config: Record<TriggerId, TriggerConfig>,
    private readonly refractoryMs = TRIGGER_REFRACTORY_MS,
  ) {}

  setConfig(config: Record<TriggerId, TriggerConfig>): void {
    this.config = config;
  }

  reset(): void {
    for (const t of TRIGGERS) this.state[t] = newState();
  }

  private clear(st: TriggerState): void {
    st.count = 0;
    st.pos = 0;
  }

  /** Count scores ≥ threshold among the newest `window` and the best of them. */
  private tally(st: TriggerState, window: number, threshold: number): { hits: number; best: number } {
    let hits = 0;
    let best = 0;
    const n = Math.min(window, st.count);
    for (let j = 1; j <= n; j++) {
      const s = st.ring[(st.pos - j + MAX_WINDOW) % MAX_WINDOW];
      if (s >= threshold) hits++;
      if (s > best) best = s;
    }
    return { hits, best };
  }

  private fire(trigger: TriggerId, confidence: number, now: number, combined?: TriggerId[]): Detection {
    for (const t of combined ?? [trigger]) {
      const st = this.state[t];
      st.lastFired = now;
      st.armed = false;
      st.quietRun = 0;
      st.weakAt = -Infinity;
      this.clear(st);
    }
    return combined ? { trigger, confidence, at: now, combined } : { trigger, confidence, at: now };
  }

  private canFire(t: TriggerId, now: number): boolean {
    const st = this.state[t];
    return !!this.config[t]?.enabled && st.armed && now - st.lastFired >= this.refractoryMs;
  }

  /** Feed one score for one trigger. Returns a detection if a rule fires. */
  push(trigger: TriggerId, score: number, now: number): Detection | null {
    const cfg = this.config[trigger];
    const rule = TRIGGER_RULES[trigger][cfg?.sensitivity ?? 'medium'];
    const st = this.state[trigger];
    st.ring[st.pos] = score;
    st.pos = (st.pos + 1) % MAX_WINDOW;
    st.count++;

    // Hysteresis: wait for the event to end before re-arming.
    if (!st.armed) {
      st.quietRun = score < rule.threshold * REARM_RATIO ? st.quietRun + 1 : 0;
      if (st.quietRun >= rule.window || now - st.lastFired >= REARM_MAX_MS) {
        st.armed = true;
        this.clear(st);
        return null;
      }
    }

    if (!cfg?.enabled) return null;
    if (!this.canFire(trigger, now)) return null;

    const strong = this.tally(st, rule.window, rule.threshold);
    if (strong.hits >= rule.hits) return this.fire(trigger, strong.best, now);

    // Weak cue: remember it, and fire if a cue of the other family is recent.
    const weak = this.tally(st, rule.window, rule.threshold * WEAK_THRESHOLD_RATIO);
    if (weak.hits < WEAK_HITS[trigger]) return null;
    st.weakAt = now;
    st.weakScore = weak.best;
    const isKeyword = KEYWORD_TRIGGERS.includes(trigger);
    let partner: TriggerId | null = null;
    let partnerStrength = 0;
    for (const t of TRIGGERS) {
      if (KEYWORD_TRIGGERS.includes(t) === isKeyword) continue; // same family
      const o = this.state[t];
      if (now - o.weakAt > COMBINE_WINDOW_MS || !this.canFire(t, now)) continue;
      const strength = o.weakScore / TRIGGER_RULES[t][this.config[t].sensitivity].threshold;
      if (strength > partnerStrength) {
        partner = t;
        partnerStrength = strength;
      }
    }
    if (!partner) return null;
    // Report the cue that is closer to its own threshold.
    const ownStrength = weak.best / rule.threshold;
    const [lead, conf] = ownStrength >= partnerStrength ? [trigger, weak.best] : [partner, this.state[partner].weakScore];
    return this.fire(lead, conf, now, lead === trigger ? [trigger, partner] : [partner, trigger]);
  }
}
