/**
 * PcmAudioBridge — captures raw microphone PCM and keeps a rolling 3-second
 * window for the on-device AudioProcessor classifier.
 *
 * Source: react-native-live-audio-stream (native module) emits base64-encoded
 * PCM16 mono chunks at 16 kHz. We decode + normalize them into a Float32 ring
 * buffer of CLIP_SIZE (48,000) samples, and hand the newest 3 s to the model
 * via getClip().
 *
 * Design notes:
 *  - Self-contained: this module does NOT import AudioProcessor, so there is no
 *    circular dependency. AudioProcessor pulls clips through getClip() and drives
 *    start()/stop() from its own lifecycle.
 *  - Base64 is decoded with a dependency-free decoder (no reliance on a global
 *    `atob`/`Buffer` polyfill, which isn't guaranteed in React Native).
 *  - The native module is loaded lazily so the app still runs where it isn't
 *    linked (Expo Go / web); real detection requires a dev/production build.
 */

import { Platform } from 'react-native';
import { SAMPLE_RATE_HZ, CLIP_SIZE } from './audioModelConfig';

/** Minimal shape of the react-native-live-audio-stream default export. */
interface LiveAudioStreamModule {
  init: (options: {
    sampleRate: number;
    channels: number;
    bitsPerSample: number;
    audioSource?: number;
    bufferSize?: number;
  }) => void;
  on: (event: 'data', listener: (base64Chunk: string) => void) => void;
  start: () => void;
  stop: () => void;
}

const BUFFER_SIZE = CLIP_SIZE; // 48,000 samples = 3 s @ 16 kHz

// ─── dependency-free base64 → bytes ────────────────────────────
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LOOKUP: Record<string, number> = (() => {
  const m: Record<string, number> = {};
  for (let i = 0; i < B64.length; i++) m[B64[i]] = i;
  return m;
})();

function base64ToUint8(b64: string): Uint8Array {
  // Strip padding + any non-base64 chars; the remaining length mod 4 tells us
  // how many bytes the final (partial) group encodes: 2 chars → 1 byte,
  // 3 chars → 2 bytes. Getting this right avoids dropping the last sample.
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const fullGroups = Math.floor(clean.length / 4);
  const rem = clean.length % 4; // 0, 2 or 3 (never 1 for valid base64)
  const outLen = fullGroups * 3 + (rem === 2 ? 1 : rem === 3 ? 2 : 0);
  const out = new Uint8Array(outLen);
  let o = 0;
  let i = 0;
  for (let g = 0; g < fullGroups; g++, i += 4) {
    const n =
      (B64_LOOKUP[clean[i]] << 18) |
      (B64_LOOKUP[clean[i + 1]] << 12) |
      (B64_LOOKUP[clean[i + 2]] << 6) |
      B64_LOOKUP[clean[i + 3]];
    out[o++] = (n >> 16) & 0xff;
    out[o++] = (n >> 8) & 0xff;
    out[o++] = n & 0xff;
  }
  if (rem === 2) {
    const n = (B64_LOOKUP[clean[i]] << 18) | (B64_LOOKUP[clean[i + 1]] << 12);
    out[o++] = (n >> 16) & 0xff;
  } else if (rem === 3) {
    const n =
      (B64_LOOKUP[clean[i]] << 18) |
      (B64_LOOKUP[clean[i + 1]] << 12) |
      (B64_LOOKUP[clean[i + 2]] << 6);
    out[o++] = (n >> 16) & 0xff;
    out[o++] = (n >> 8) & 0xff;
  }
  return out;
}

export class PcmAudioBridge {
  private ringBuffer: Float32Array = new Float32Array(BUFFER_SIZE);
  private writeHead = 0;
  private running = false;
  private subscribed = false;
  private stream: LiveAudioStreamModule | null = null;

  /**
   * Push raw PCM16 samples (Int16Array, ArrayBuffer, or base64 string) into the
   * ring buffer, normalized to Float32 [-1, 1].
   */
  public pushPcm16Chunk(chunk: Int16Array | ArrayBuffer | string): void {
    let int16Samples: Int16Array;

    if (typeof chunk === 'string') {
      const bytes = base64ToUint8(chunk);
      // reinterpret little-endian PCM16; guard against an odd byte count
      const usable = bytes.byteLength - (bytes.byteLength % 2);
      int16Samples = new Int16Array(bytes.buffer, 0, usable / 2);
    } else if (chunk instanceof ArrayBuffer) {
      int16Samples = new Int16Array(chunk);
    } else {
      int16Samples = chunk;
    }

    for (let i = 0; i < int16Samples.length; i++) {
      // Normalize Int16 [-32768, 32767] -> Float32 [-1.0, 1.0]
      this.ringBuffer[this.writeHead] = int16Samples[i] / 32768.0;
      this.writeHead = (this.writeHead + 1) % BUFFER_SIZE;
    }
  }

  /** Newest 3 s of audio (48,000 Float32 samples) in chronological order. */
  public async getClip(): Promise<Float32Array> {
    const output = new Float32Array(BUFFER_SIZE);
    const oldestCount = BUFFER_SIZE - this.writeHead;
    output.set(this.ringBuffer.subarray(this.writeHead, BUFFER_SIZE), 0);
    output.set(this.ringBuffer.subarray(0, this.writeHead), oldestCount);
    return output;
  }

  /**
   * Start capturing microphone PCM. Returns true if the native stream started,
   * false if unavailable (web / module not linked) — callers can treat false as
   * "audio detection not active on this build".
   */
  public async start(): Promise<boolean> {
    if (this.running) return true;
    if (Platform.OS === 'web') return false;
    try {
      if (!this.stream) {
        // Lazy require so a missing native module doesn't crash app startup.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const mod = require('react-native-live-audio-stream');
        this.stream = (mod?.default ?? mod) as LiveAudioStreamModule;
      }
      if (!this.stream?.init) return false;

      this.stream.init({
        sampleRate: SAMPLE_RATE_HZ, // 16 kHz — matches the model
        channels: 1, // mono
        bitsPerSample: 16, // PCM16
        audioSource: 6, // Android VOICE_RECOGNITION (ignored on iOS)
        bufferSize: 4096,
      });

      if (!this.subscribed) {
        this.stream.on('data', (base64Chunk: string) => {
          if (!this.running) return; // ignore late events after stop()
          try {
            this.pushPcm16Chunk(base64Chunk);
          } catch (e) {
            if (__DEV__) console.warn('[ML] PcmAudioBridge decode error', e);
          }
        });
        this.subscribed = true;
      }

      this.running = true;
      this.stream.start();
      if (__DEV__) console.log('[ML] PcmAudioBridge started (16kHz mono PCM capture).');
      return true;
    } catch (e) {
      // Most common cause: running in Expo Go where the native module isn't linked.
      if (__DEV__) console.warn('[ML] PcmAudioBridge unavailable (needs a dev/prod build):', e);
      this.running = false;
      return false;
    }
  }

  /** Stop capturing and clear the buffer so stale audio never leaks into a clip. */
  public stop(): void {
    if (!this.running) return;
    this.running = false;
    try {
      this.stream?.stop();
    } catch {
      /* ignore */
    }
    this.ringBuffer.fill(0);
    this.writeHead = 0;
    if (__DEV__) console.log('[ML] PcmAudioBridge stopped.');
  }

  public get isRunning(): boolean {
    return this.running;
  }
}

export const pcmAudioBridge = new PcmAudioBridge();
