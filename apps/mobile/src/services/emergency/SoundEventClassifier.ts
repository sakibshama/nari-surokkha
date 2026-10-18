/**
 * Shout / cry detection with YAMNet (AudioSet, 521 classes).
 *
 * Keeps the newest 0.975 s of audio and classifies it every 0.5 s, so a one
 * second shout is seen by two overlapping windows.
 *
 * Alongside the model it measures loudness in 80 ms blocks: the loudest block
 * of each window, and a running noise-floor estimate. Windows with nothing
 * above the silence gate are not classified at all (all scores 0).
 */

import {
  COMPETITOR_DOMINANCE,
  COMPETITOR_MIN_SCORE,
  GATE_OPEN_DBFS,
  LEVEL_BLOCK,
  NOISE_FLOOR_BLOCKS,
  NOISE_FLOOR_PERCENTILE,
  SHOUT_MIN_DBFS,
  SHOUT_MIN_PROMINENCE_DB,
  YAMNET_BABY_CRY,
  YAMNET_CRY_CLASSES,
  YAMNET_CRY_COMPETITORS,
  YAMNET_HOP,
  YAMNET_INPUT,
  YAMNET_SHOUT_CLASSES,
  YAMNET_SHOUT_COMPETITORS,
  YAMNET_SPEECH,
} from './constants';
import type { TensorModel } from './TensorModel';

export interface YamnetSummary {
  shout: number;
  cry: number;
  speech: number;
  babyCry: number;
  /** Strongest class that is commonly mistaken for a shout (music, cheering, …). */
  shoutCompetitor: number;
  /** Strongest class that is commonly mistaken for crying (laughter, …). */
  cryCompetitor: number;
}

export interface SoundEventScores extends YamnetSummary {
  /** RMS level of the analysed window in dBFS (for the UI meter and logs). */
  levelDb: number;
  /** Loudest 80 ms block in (about) the analysed window, dBFS. */
  peakDb: number;
  /** Background level: a low percentile of the last ~5 s of 80 ms blocks, dBFS. */
  floorDb: number;
  /** True when the window was below the silence gate and YAMNet was skipped. */
  gated: boolean;
}

/** Effective per-window evidence after the loudness and competitor checks. */
export interface SoundEvidence {
  shout: number;
  cry: number;
  /** Why a non-zero raw score was set to 0 (for logs / the live meter). */
  shoutSuppressed: null | 'quiet' | 'not_prominent' | 'competitor';
  crySuppressed: null | 'competitor';
}

const maxOf = (scores: Float32Array, classes: readonly number[]): number => {
  let m = 0;
  for (const c of classes) if (scores[c] > m) m = scores[c];
  return m;
};

export function aggregateYamnet(scores: Float32Array): YamnetSummary {
  return {
    shout: maxOf(scores, YAMNET_SHOUT_CLASSES),
    cry: maxOf(scores, YAMNET_CRY_CLASSES),
    speech: scores[YAMNET_SPEECH],
    babyCry: scores[YAMNET_BABY_CRY],
    shoutCompetitor: maxOf(scores, YAMNET_SHOUT_COMPETITORS),
    cryCompetitor: maxOf(scores, YAMNET_CRY_COMPETITORS),
  };
}

const dominated = (score: number, competitor: number) =>
  competitor >= COMPETITOR_MIN_SCORE && competitor >= score * COMPETITOR_DOMINANCE;

/**
 * Turns one window's scores into the evidence the trigger rules see:
 *  - a shout must be loud (SHOUT_MIN_DBFS) and stand out from the background
 *    (SHOUT_MIN_PROMINENCE_DB);
 *  - a shout or cry is ignored when a commonly confused class (music,
 *    cheering, laughter, TV, …) clearly dominates the same window.
 */
export function soundEvidence(s: SoundEventScores): SoundEvidence {
  let shout = s.shout;
  let shoutSuppressed: SoundEvidence['shoutSuppressed'] = null;
  if (shout > 0) {
    if (s.peakDb < SHOUT_MIN_DBFS) shoutSuppressed = 'quiet';
    else if (s.peakDb - s.floorDb < SHOUT_MIN_PROMINENCE_DB) shoutSuppressed = 'not_prominent';
    else if (dominated(shout, s.shoutCompetitor)) shoutSuppressed = 'competitor';
    if (shoutSuppressed) shout = 0;
  }
  let cry = s.cry;
  let crySuppressed: SoundEvidence['crySuppressed'] = null;
  if (cry > 0 && dominated(cry, s.cryCompetitor)) {
    crySuppressed = 'competitor';
    cry = 0;
  }
  return { shout, cry, shoutSuppressed, crySuppressed };
}

export function rmsDb(x: Float32Array): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  const rms = Math.sqrt(s / Math.max(1, x.length));
  return 20 * Math.log10(rms + 1e-9);
}

/** Blocks covering (about) one YAMNet window. */
const WINDOW_BLOCKS = Math.ceil(YAMNET_INPUT / LEVEL_BLOCK); // 13

export interface SoundEventOptions {
  /** Silence gate in dBFS; -Infinity disables it (always classify). */
  gateDb?: number;
}

export class SoundEventClassifier {
  private readonly window = new Float32Array(YAMNET_INPUT);
  private filled = 0;
  private sinceLast = 0;

  // 80 ms block levels (dBFS), newest last in a ring.
  private readonly blocks = new Float32Array(NOISE_FLOOR_BLOCKS);
  private blockCount = 0;
  private blockPos = 0;
  private blockSum = 0;
  private blockFill = 0;
  private readonly sortScratch = new Float32Array(NOISE_FLOOR_BLOCKS);

  private readonly gateDb: number;

  /** Windows analysed / skipped by the gate (efficiency stats). */
  readonly stats = { runs: 0, gated: 0 };

  constructor(
    private readonly model: TensorModel,
    opts: SoundEventOptions = {},
  ) {
    this.gateDb = opts.gateDb ?? GATE_OPEN_DBFS;
  }

  reset(): void {
    this.window.fill(0);
    this.filled = 0;
    this.sinceLast = 0;
    this.blocks.fill(0);
    this.blockCount = 0;
    this.blockPos = 0;
    this.blockSum = 0;
    this.blockFill = 0;
  }

  private addLevels(x: Float32Array): void {
    for (let i = 0; i < x.length; i++) {
      this.blockSum += x[i] * x[i];
      if (++this.blockFill === LEVEL_BLOCK) {
        this.blocks[this.blockPos] = 10 * Math.log10(this.blockSum / LEVEL_BLOCK + 1e-12);
        this.blockPos = (this.blockPos + 1) % NOISE_FLOOR_BLOCKS;
        this.blockCount = Math.min(NOISE_FLOOR_BLOCKS, this.blockCount + 1);
        this.blockSum = 0;
        this.blockFill = 0;
      }
    }
  }

  /** Loudest of the newest `n` complete blocks. */
  private peakDb(n: number): number {
    let m = -120;
    const k = Math.min(n, this.blockCount);
    for (let j = 1; j <= k; j++) {
      const v = this.blocks[(this.blockPos - j + NOISE_FLOOR_BLOCKS) % NOISE_FLOOR_BLOCKS];
      if (v > m) m = v;
    }
    return m;
  }

  /**
   * Low percentile of the stored blocks (the background level). Until half
   * the history exists (≈2.5 s after start) there is no reliable background,
   * so -120 is returned and the prominence rule cannot reject anything.
   */
  private floorDb(): number {
    const n = this.blockCount;
    if (n < NOISE_FLOOR_BLOCKS / 2) return -120;
    const a = this.sortScratch.subarray(0, n);
    for (let j = 0; j < n; j++) a[j] = this.blocks[(this.blockPos - 1 - j + NOISE_FLOOR_BLOCKS) % NOISE_FLOOR_BLOCKS];
    a.sort();
    return a[Math.min(n - 1, Math.floor(NOISE_FLOOR_PERCENTILE * n))];
  }

  async push(samples: Float32Array): Promise<SoundEventScores[]> {
    const out: SoundEventScores[] = [];
    let i = 0;
    while (i < samples.length) {
      const take = Math.min(YAMNET_HOP - this.sinceLast, samples.length - i);
      const chunk = samples.subarray(i, i + take);
      // slide window left and append
      this.window.copyWithin(0, take);
      this.window.set(chunk, YAMNET_INPUT - take);
      this.addLevels(chunk);
      this.filled = Math.min(YAMNET_INPUT, this.filled + take);
      this.sinceLast += take;
      i += take;
      if (this.sinceLast === YAMNET_HOP) {
        this.sinceLast = 0;
        if (this.filled < YAMNET_INPUT) continue;
        const peakDb = this.peakDb(WINDOW_BLOCKS);
        const levels = { levelDb: rmsDb(this.window), peakDb, floorDb: this.floorDb() };
        if (peakDb < this.gateDb) {
          this.stats.gated++;
          out.push({ shout: 0, cry: 0, speech: 0, babyCry: 0, shoutCompetitor: 0, cryCompetitor: 0, ...levels, gated: true });
          continue;
        }
        this.stats.runs++;
        const [scores] = await this.model.run([this.window]);
        out.push({ ...aggregateYamnet(scores), ...levels, gated: false });
      }
    }
    return out;
  }
}
