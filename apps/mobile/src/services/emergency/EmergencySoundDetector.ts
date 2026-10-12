/**
 * EmergencySoundDetector — listens to the microphone and raises a Detection
 * when it hears a shout/scream, crying, "Help" or "Bachao" (বাঁচাও).
 *
 * Everything runs on the phone. No audio is recorded to disk or uploaded:
 * samples live in memory for at most ~2 s and are overwritten continuously.
 *
 * The class is runtime-agnostic: the microphone and the models are injected,
 * which is what lets the unit tests drive the exact same code with recorded
 * WAV files and ONNX copies of the models.
 */

import { SAMPLE_RATE, TriggerId } from './constants';
import { KeywordScores, KeywordSpotter } from './KeywordSpotter';
import { SoundEventClassifier, SoundEventScores } from './SoundEventClassifier';
import type { EmergencyModels } from './tfliteModels';
import { Detection, TriggerConfig, TriggerDecider } from './TriggerDecider';

export type DetectorStatus =
  | { state: 'stopped' }
  | { state: 'starting' }
  | { state: 'listening'; since: number }
  | { state: 'paused'; reason: string }
  | { state: 'error'; message: string };

export interface LiveScores {
  shout: number;
  cry: number;
  help: number;
  bachao: number;
  levelDb: number;
  at: number;
}

export interface AudioSource {
  start(): Promise<void>;
  stop(): void;
  addListener(cb: (samples: Float32Array) => void): () => void;
}

/** Audio older than this is dropped if inference falls behind (keeps us real-time). */
const MAX_BACKLOG_SAMPLES = SAMPLE_RATE * 3;
const LIVE_EMIT_INTERVAL_MS = 200;

export class EmergencySoundDetector {
  private status: DetectorStatus = { state: 'stopped' };
  private statusListeners = new Set<(s: DetectorStatus) => void>();
  private detectionListeners = new Set<(d: Detection) => void>();
  private liveListeners = new Set<(s: LiveScores) => void>();

  private kws: KeywordSpotter | null = null;
  private yamnet: SoundEventClassifier | null = null;
  private readonly decider: TriggerDecider;

  private queue: Float32Array[] = [];
  private queued = 0;
  private draining = false;
  private unsubscribeMic: (() => void) | null = null;
  private live: LiveScores = { shout: 0, cry: 0, help: 0, bachao: 0, levelDb: -120, at: 0 };
  private lastLiveEmit = 0;
  /** Monotonic run id: chunks from a previous start() are ignored. */
  private generation = 0;

  readonly stats = { processedSeconds: 0, droppedSeconds: 0, inferenceMs: 0, steps: 0 };

  constructor(
    private readonly source: AudioSource,
    private readonly loadModels: () => Promise<EmergencyModels>,
    config: Record<TriggerId, TriggerConfig>,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.decider = new TriggerDecider(config);
  }

  // ── observers ──
  getStatus(): DetectorStatus {
    return this.status;
  }
  onStatus(cb: (s: DetectorStatus) => void): () => void {
    this.statusListeners.add(cb);
    cb(this.status);
    return () => this.statusListeners.delete(cb);
  }
  onDetection(cb: (d: Detection) => void): () => void {
    this.detectionListeners.add(cb);
    return () => this.detectionListeners.delete(cb);
  }
  onLiveScores(cb: (s: LiveScores) => void): () => void {
    this.liveListeners.add(cb);
    return () => this.liveListeners.delete(cb);
  }

  setConfig(config: Record<TriggerId, TriggerConfig>): void {
    this.decider.setConfig(config);
  }

  private setStatus(s: DetectorStatus): void {
    this.status = s;
    this.statusListeners.forEach((l) => l(s));
  }

  // ── lifecycle ──
  async start(): Promise<void> {
    if (this.status.state === 'listening' || this.status.state === 'starting') return;
    const gen = ++this.generation;
    this.setStatus({ state: 'starting' });
    try {
      const models = await this.loadModels();
      if (gen !== this.generation) return; // stopped while loading
      this.kws = new KeywordSpotter(models.kwsMel, models.kwsEmbedding, models.kwsHead);
      this.yamnet = new SoundEventClassifier(models.yamnet);
      this.decider.reset();
      this.queue = [];
      this.queued = 0;
      this.unsubscribeMic?.();
      this.unsubscribeMic = this.source.addListener((s) => this.enqueue(s, gen));
      await this.source.start();
      if (gen !== this.generation) return;
      this.setStatus({ state: 'listening', since: this.now() });
    } catch (e) {
      if (gen !== this.generation) return;
      this.unsubscribeMic?.();
      this.unsubscribeMic = null;
      this.source.stop();
      this.setStatus({ state: 'error', message: (e as Error)?.message ?? String(e) });
    }
  }

  stop(): void {
    this.generation++;
    this.release();
    this.setStatus({ state: 'stopped' });
  }

  /** Release the microphone for something else (an active SOS call, a recording). */
  pause(reason: string): void {
    if (this.status.state === 'stopped') return;
    this.generation++;
    this.release();
    this.setStatus({ state: 'paused', reason });
  }

  private release(): void {
    this.unsubscribeMic?.();
    this.unsubscribeMic = null;
    this.source.stop();
    this.queue = [];
    this.queued = 0;
    this.kws?.reset();
    this.yamnet?.reset();
  }

  // ── processing ──
  /** Exposed for tests: feed PCM directly (bypasses the microphone). */
  enqueue(samples: Float32Array, gen = this.generation): void {
    if (gen !== this.generation) return;
    this.queue.push(samples);
    this.queued += samples.length;
    while (this.queued > MAX_BACKLOG_SAMPLES && this.queue.length > 1) {
      const dropped = this.queue.shift()!;
      this.queued -= dropped.length;
      this.stats.droppedSeconds += dropped.length / SAMPLE_RATE;
    }
    if (!this.draining) void this.drain(gen);
  }

  /** Resolves once everything queued so far has been analysed (tests). */
  async flush(): Promise<void> {
    while (this.draining || this.queue.length) await new Promise((r) => setTimeout(r, 5));
  }

  private async drain(gen: number): Promise<void> {
    this.draining = true;
    try {
      while (this.queue.length && gen === this.generation) {
        const chunk = this.queue.shift()!;
        this.queued -= chunk.length;
        const t0 = this.now();
        const kws = this.kws;
        const yam = this.yamnet;
        if (!kws || !yam) break;
        const [kwScores, evScores] = await Promise.all([kws.push(chunk), yam.push(chunk)]);
        if (gen !== this.generation) break;
        this.stats.inferenceMs += this.now() - t0;
        this.stats.processedSeconds += chunk.length / SAMPLE_RATE;
        this.handle(kwScores, evScores);
      }
    } catch (e) {
      if (gen === this.generation) {
        this.release();
        this.setStatus({ state: 'error', message: `Inference failed: ${(e as Error)?.message ?? e}` });
      }
    } finally {
      this.draining = false;
    }
  }

  private handle(kw: KeywordScores[], ev: SoundEventScores[]): void {
    const now = this.now();
    for (const s of kw) {
      this.stats.steps++;
      this.live.help = Math.max(this.live.help * 0.6, s.help);
      this.live.bachao = Math.max(this.live.bachao * 0.6, s.bachao);
      this.emit(this.decider.push('help', s.help, now));
      this.emit(this.decider.push('bachao', s.bachao, now));
    }
    for (const s of ev) {
      this.live.shout = s.shout;
      this.live.cry = s.cry;
      this.live.levelDb = s.levelDb;
      this.emit(this.decider.push('shout', s.shout, now));
      this.emit(this.decider.push('cry', s.cry, now));
    }
    if (this.liveListeners.size && now - this.lastLiveEmit >= LIVE_EMIT_INTERVAL_MS) {
      this.lastLiveEmit = now;
      const snap = { ...this.live, at: now };
      this.liveListeners.forEach((l) => l(snap));
    }
  }

  private emit(d: Detection | null): void {
    if (!d) return;
    this.detectionListeners.forEach((l) => {
      try {
        l(d);
      } catch (e) {
        if (__DEV__) console.warn('[detector] listener error', e);
      }
    });
  }
}
