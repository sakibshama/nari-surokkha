/**
 * Raw microphone PCM (16 kHz, mono, PCM16) from react-native-live-audio-stream.
 *
 * The native module emits base64 chunks (~128 ms each) on a native recording
 * thread; we decode them to Float32 and hand them to subscribers.
 *
 * Notes on the native module (see patches/react-native-live-audio-stream+1.1.1.patch):
 *  - init() allocates an AudioRecord, so it is called once per process and
 *    only after RECORD_AUDIO is granted.
 *  - stop() returns before the recording thread has exited, so a restart
 *    waits briefly to avoid two threads reading the same AudioRecord.
 */

import { Platform } from 'react-native';
import { SAMPLE_RATE } from './constants';
import { base64Pcm16ToFloat32 } from './pcm';

interface LiveAudioStream {
  init(options: { sampleRate: number; channels: number; bitsPerSample: number; audioSource?: number; bufferSize?: number; wavFile?: string }): void;
  on(event: 'data', listener: (b64: string) => void): unknown;
  start(): void;
  stop(): unknown;
}

type ChunkListener = (samples: Float32Array) => void;

const ANDROID_VOICE_RECOGNITION = 6; // unprocessed-ish source: no AGC/noise suppression
const RESTART_GUARD_MS = 350;

class MicrophoneStream {
  private mod: LiveAudioStream | null = null;
  private initialised = false;
  private subscribed = false;
  private running = false;
  private stoppedAt = 0;
  private listeners = new Set<ChunkListener>();
  private lastChunkAt = 0;
  /** Bumped by stop(); a pending start() from an older epoch gives up. */
  private epoch = 0;
  private starting: { epoch: number; promise: Promise<void> } | null = null;

  get isRunning(): boolean {
    return this.running;
  }

  /** Time of the last audio chunk (0 if none) — lets the UI spot a dead mic. */
  get lastChunkTime(): number {
    return this.lastChunkAt;
  }

  isSupported(): boolean {
    if (Platform.OS === 'web') return false;
    return this.load() !== null;
  }

  private load(): LiveAudioStream | null {
    if (this.mod) return this.mod;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const m = require('react-native-live-audio-stream');
      const mod = (m?.default ?? m) as LiveAudioStream;
      this.mod = mod && typeof mod.init === 'function' ? mod : null;
    } catch {
      this.mod = null;
    }
    return this.mod;
  }

  addListener(cb: ChunkListener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /**
   * Caller must have obtained RECORD_AUDIO permission first.
   *
   * Safe to call concurrently with stop(): a stop() that lands while start()
   * is still waiting for the restart guard cancels that start (previously the
   * pending start went on to open the microphone after stop() had returned,
   * leaving it recording with nobody listening).
   */
  start(): Promise<void> {
    if (this.running) return Promise.resolve();
    const pending = this.starting;
    if (pending) {
      // A start is already in flight. If a stop() has cancelled it since, start
      // again once it has settled; otherwise share it.
      if (pending.epoch === this.epoch) return pending.promise;
      return pending.promise.then(
        () => this.start(),
        () => this.start(),
      );
    }
    const epoch = this.epoch;
    const promise = this.doStart(epoch).finally(() => {
      if (this.starting?.promise === promise) this.starting = null;
    });
    this.starting = { epoch, promise };
    return promise;
  }

  private async doStart(epoch: number): Promise<void> {
    const mod = this.load();
    if (!mod) throw new Error('Microphone streaming module is not in this build.');

    const sinceStop = Date.now() - this.stoppedAt;
    if (sinceStop < RESTART_GUARD_MS) await new Promise((r) => setTimeout(r, RESTART_GUARD_MS - sinceStop));
    if (epoch !== this.epoch || this.running) return; // stopped (or started by someone else) meanwhile

    if (!this.initialised) {
      mod.init({
        sampleRate: SAMPLE_RATE,
        channels: 1,
        bitsPerSample: 16,
        audioSource: ANDROID_VOICE_RECOGNITION,
        bufferSize: 4096, // bytes → 2048 samples → 128 ms per chunk
        wavFile: '', // iOS module requires the key; we never write a file
      });
      this.initialised = true;
    }
    if (!this.subscribed) {
      mod.on('data', (b64: string) => {
        if (!this.running) return;
        this.lastChunkAt = Date.now();
        let samples: Float32Array;
        try {
          samples = base64Pcm16ToFloat32(b64);
        } catch {
          return;
        }
        if (samples.length === 0) return;
        this.listeners.forEach((l) => {
          try {
            l(samples);
          } catch (e) {
            if (__DEV__) console.warn('[mic] listener error', e);
          }
        });
      });
      this.subscribed = true;
    }
    this.running = true;
    this.lastChunkAt = 0;
    mod.start();
  }

  stop(): void {
    this.epoch++; // cancels a start() that is still waiting
    if (!this.running) return;
    this.running = false;
    this.stoppedAt = Date.now();
    try {
      void this.mod?.stop();
    } catch {
      /* already stopped */
    }
  }
}

export const microphoneStream = new MicrophoneStream();
