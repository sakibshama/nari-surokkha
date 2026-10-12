/**
 * Streaming keyword spotter for "Help" and "Bachao" (বাঁচাও).
 *
 * Pipeline (identical to services/ml-training/keywords/feats.py, which the
 * classifier head was trained on):
 *
 *   every 1280 new samples (80 ms)
 *     mel   : newest 1760 samples (int16 scale)      -> 8 × 32 log-mel frames
 *     embed : newest 76 mel frames                    -> one 96-d speech embedding
 *     head  : newest 16 embeddings (1.28 s of speech) -> P(help), P(bachao)
 *
 * The mel and embedding models are Google's speech_embedding front-end as
 * packaged by openWakeWord; the head is ours.
 */

import {
  KWS_CONTEXT,
  KWS_EMB_DIM,
  KWS_EMB_WINDOW,
  KWS_HEAD_WINDOW,
  KWS_HOP,
  KWS_INPUT_SCALE,
  KWS_MEL_BINS,
  KWS_MEL_FRAMES_PER_HOP,
  KWS_MEL_INPUT,
} from './constants';
import type { TensorModel } from './TensorModel';

export interface KeywordScores {
  help: number;
  bachao: number;
}

export class KeywordSpotter {
  /** Newest 1760 samples, int16-scaled — the mel model's input. */
  private readonly ctx = new Float32Array(KWS_MEL_INPUT);
  /** Samples received since the last hop. */
  private readonly pending = new Float32Array(KWS_HOP);
  private pendingCount = 0;
  /** Newest 76 mel frames, oldest first. */
  private readonly mel = new Float32Array(KWS_EMB_WINDOW * KWS_MEL_BINS);
  private melCount = 0;
  /** Newest 16 embeddings, oldest first. */
  private readonly emb = new Float32Array(KWS_HEAD_WINDOW * KWS_EMB_DIM);
  private embCount = 0;

  constructor(
    private readonly melModel: TensorModel,
    private readonly embModel: TensorModel,
    private readonly headModel: TensorModel,
  ) {}

  reset(): void {
    this.ctx.fill(0);
    this.pendingCount = 0;
    this.mel.fill(0);
    this.melCount = 0;
    this.emb.fill(0);
    this.embCount = 0;
  }

  /**
   * Feed PCM in [-1, 1]. Returns one score pair per completed 80 ms hop once
   * 1.28 s + 0.76 s of audio has been seen (earlier hops only fill buffers).
   */
  async push(samples: Float32Array): Promise<KeywordScores[]> {
    const out: KeywordScores[] = [];
    let i = 0;
    while (i < samples.length) {
      const take = Math.min(KWS_HOP - this.pendingCount, samples.length - i);
      this.pending.set(samples.subarray(i, i + take), this.pendingCount);
      this.pendingCount += take;
      i += take;
      if (this.pendingCount === KWS_HOP) {
        this.pendingCount = 0;
        const s = await this.step();
        if (s) out.push(s);
      }
    }
    return out;
  }

  private async step(): Promise<KeywordScores | null> {
    // Slide the 1760-sample context left by one hop and append the new hop.
    this.ctx.copyWithin(0, KWS_HOP);
    for (let k = 0; k < KWS_HOP; k++) this.ctx[KWS_CONTEXT + k] = this.pending[k] * KWS_INPUT_SCALE;

    const [melOut] = await this.melModel.run([this.ctx]);
    const newVals = KWS_MEL_FRAMES_PER_HOP * KWS_MEL_BINS;
    this.mel.copyWithin(0, newVals);
    this.mel.set(melOut.subarray(0, newVals), this.mel.length - newVals);
    this.melCount = Math.min(KWS_EMB_WINDOW, this.melCount + KWS_MEL_FRAMES_PER_HOP);
    if (this.melCount < KWS_EMB_WINDOW) return null;

    const [embOut] = await this.embModel.run([this.mel]);
    this.emb.copyWithin(0, KWS_EMB_DIM);
    this.emb.set(embOut.subarray(0, KWS_EMB_DIM), this.emb.length - KWS_EMB_DIM);
    this.embCount = Math.min(KWS_HEAD_WINDOW, this.embCount + 1);
    if (this.embCount < KWS_HEAD_WINDOW) return null;

    const [headOut] = await this.headModel.run([this.emb]);
    return { help: headOut[0], bachao: headOut[1] };
  }
}
