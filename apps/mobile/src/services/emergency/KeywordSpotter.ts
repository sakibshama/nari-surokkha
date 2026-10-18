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
 *
 * Silence gate: the newest score depends on the last 26 hops (2.08 s) of audio
 * only (KWS_RECEPTIVE_HOPS). When none of those hops reached GATE_OPEN_DBFS the
 * models are not run and the hop scores 0. The raw audio of the last 26 hops
 * is kept, and when sound returns the spotter is reset and that audio is
 * replayed through the mel/embedding models, so the first score after the gate
 * opens is exactly what continuous processing would have produced.
 */

import {
  GATE_OPEN_DBFS,
  KWS_CONTEXT,
  KWS_EMB_DIM,
  KWS_EMB_WINDOW,
  KWS_HEAD_WINDOW,
  KWS_HOP,
  KWS_INPUT_SCALE,
  KWS_MEL_BINS,
  KWS_MEL_FRAMES_PER_HOP,
  KWS_MEL_INPUT,
  KWS_RECEPTIVE_HOPS,
} from './constants';
import type { TensorModel } from './TensorModel';

export interface KeywordScores {
  help: number;
  bachao: number;
  /** True when the hop was silent and the models were skipped (scores are 0). */
  gated?: boolean;
}

export interface KeywordSpotterOptions {
  /** Silence gate in dBFS; -Infinity disables it (always run the models). */
  gateDb?: number;
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

  /** Raw (unscaled) audio of the last KWS_RECEPTIVE_HOPS hops, a ring of hops. */
  private readonly history = new Float32Array(KWS_RECEPTIVE_HOPS * KWS_HOP);
  private historyPos = 0; // next hop slot to write
  private historyCount = 0;
  /** Hops seen since reset and the last one that was above the gate. */
  private hopIndex = 0;
  private lastLoudHop = -Infinity;
  /** Model state is in step with the audio (false while gated). */
  private live = false;
  private readonly gateLinear: number;

  /** Hops scored / skipped by the gate / replayed after re-opening (efficiency stats). */
  readonly stats = { scored: 0, gated: 0, replayed: 0 };

  constructor(
    private readonly melModel: TensorModel,
    private readonly embModel: TensorModel,
    private readonly headModel: TensorModel,
    opts: KeywordSpotterOptions = {},
  ) {
    const gateDb = opts.gateDb ?? GATE_OPEN_DBFS;
    // compare mean-square energy directly (no log per hop)
    this.gateLinear = gateDb === -Infinity ? -1 : 10 ** (gateDb / 10);
  }

  reset(): void {
    this.resetModelState();
    this.pendingCount = 0;
    this.history.fill(0);
    this.historyPos = 0;
    this.historyCount = 0;
    this.hopIndex = 0;
    this.lastLoudHop = -Infinity;
    this.live = false;
  }

  private resetModelState(): void {
    this.ctx.fill(0);
    this.mel.fill(0);
    this.melCount = 0;
    this.emb.fill(0);
    this.embCount = 0;
  }

  /**
   * Feed PCM in [-1, 1]. Returns one score pair per completed 80 ms hop once
   * 1.28 s + 0.76 s of audio has been seen (earlier hops only fill buffers).
   * Hops inside a silent stretch score { help: 0, bachao: 0, gated: true }.
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
        const s = await this.hop();
        if (s) out.push(s);
      }
    }
    return out;
  }

  private async hop(): Promise<KeywordScores | null> {
    let energy = 0;
    for (let k = 0; k < KWS_HOP; k++) energy += this.pending[k] * this.pending[k];
    energy /= KWS_HOP;
    const h = this.hopIndex++;
    if (energy >= this.gateLinear) this.lastLoudHop = h;
    const open = h - this.lastLoudHop < KWS_RECEPTIVE_HOPS;

    let result: KeywordScores | null = null;
    if (!open) {
      this.live = false;
      this.stats.gated++;
      // Only report once a score could have existed (keeps the warm-up contract).
      result = h >= KWS_RECEPTIVE_HOPS - 2 ? { help: 0, bachao: 0, gated: true } : null;
    } else {
      if (!this.live) await this.replay();
      this.live = true;
      result = await this.step(this.pending, true);
      if (result) this.stats.scored++;
    }
    // remember this hop's raw audio
    this.history.set(this.pending, this.historyPos * KWS_HOP);
    this.historyPos = (this.historyPos + 1) % KWS_RECEPTIVE_HOPS;
    this.historyCount = Math.min(KWS_RECEPTIVE_HOPS, this.historyCount + 1);
    return result;
  }

  /**
   * Rebuild the model state from the stored audio (oldest first). After the
   * newest 25 hops + 480 samples have gone through, the state is identical to
   * continuous processing; the head is not run for these hops.
   */
  private async replay(): Promise<void> {
    this.resetModelState();
    const n = this.historyCount;
    const start = (this.historyPos - n + KWS_RECEPTIVE_HOPS) % KWS_RECEPTIVE_HOPS;
    for (let j = 0; j < n; j++) {
      const slot = (start + j) % KWS_RECEPTIVE_HOPS;
      // The next score uses the embeddings of the current hop and the 15
      // before it; older replayed hops only need their mel frames.
      const needEmb = j >= n - (KWS_HEAD_WINDOW - 1);
      await this.step(this.history.subarray(slot * KWS_HOP, (slot + 1) * KWS_HOP), false, needEmb);
      this.stats.replayed++;
    }
  }

  private async step(hop: Float32Array, score: boolean, needEmb = true): Promise<KeywordScores | null> {
    // Slide the 1760-sample context left by one hop and append the new hop.
    this.ctx.copyWithin(0, KWS_HOP);
    for (let k = 0; k < KWS_HOP; k++) this.ctx[KWS_CONTEXT + k] = hop[k] * KWS_INPUT_SCALE;

    const [melOut] = await this.melModel.run([this.ctx]);
    const newVals = KWS_MEL_FRAMES_PER_HOP * KWS_MEL_BINS;
    this.mel.copyWithin(0, newVals);
    this.mel.set(melOut.subarray(0, newVals), this.mel.length - newVals);
    this.melCount = Math.min(KWS_EMB_WINDOW, this.melCount + KWS_MEL_FRAMES_PER_HOP);
    if (this.melCount < KWS_EMB_WINDOW || !needEmb) return null;

    const [embOut] = await this.embModel.run([this.mel]);
    this.emb.copyWithin(0, KWS_EMB_DIM);
    this.emb.set(embOut.subarray(0, KWS_EMB_DIM), this.emb.length - KWS_EMB_DIM);
    this.embCount = Math.min(KWS_HEAD_WINDOW, this.embCount + 1);
    if (!score || this.embCount < KWS_HEAD_WINDOW) return null;

    const [headOut] = await this.headModel.run([this.emb]);
    return { help: headOut[0], bachao: headOut[1] };
  }
}
