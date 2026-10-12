/**
 * Shout / cry detection with YAMNet (AudioSet, 521 classes).
 *
 * Keeps the newest 0.975 s of audio and classifies it every 0.5 s, so a one
 * second shout is seen by two overlapping windows.
 */

import {
  YAMNET_BABY_CRY,
  YAMNET_CRY_CLASSES,
  YAMNET_HOP,
  YAMNET_INPUT,
  YAMNET_SHOUT_CLASSES,
  YAMNET_SPEECH,
} from './constants';
import type { TensorModel } from './TensorModel';

export interface SoundEventScores {
  shout: number;
  cry: number;
  speech: number;
  babyCry: number;
  /** RMS level of the analysed window in dBFS (for the UI meter and logs). */
  levelDb: number;
}

export function aggregateYamnet(scores: Float32Array): Omit<SoundEventScores, 'levelDb'> {
  let shout = 0;
  for (const c of YAMNET_SHOUT_CLASSES) shout = Math.max(shout, scores[c]);
  let cry = 0;
  for (const c of YAMNET_CRY_CLASSES) cry = Math.max(cry, scores[c]);
  return { shout, cry, speech: scores[YAMNET_SPEECH], babyCry: scores[YAMNET_BABY_CRY] };
}

export function rmsDb(x: Float32Array): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  const rms = Math.sqrt(s / Math.max(1, x.length));
  return 20 * Math.log10(rms + 1e-9);
}

export class SoundEventClassifier {
  private readonly window = new Float32Array(YAMNET_INPUT);
  private filled = 0;
  private sinceLast = 0;

  constructor(private readonly model: TensorModel) {}

  reset(): void {
    this.window.fill(0);
    this.filled = 0;
    this.sinceLast = 0;
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
      this.filled = Math.min(YAMNET_INPUT, this.filled + take);
      this.sinceLast += take;
      i += take;
      if (this.sinceLast === YAMNET_HOP) {
        this.sinceLast = 0;
        if (this.filled < YAMNET_INPUT) continue;
        const [scores] = await this.model.run([this.window]);
        out.push({ ...aggregateYamnet(scores), levelDb: rmsDb(this.window) });
      }
    }
    return out;
  }
}
