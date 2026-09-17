/**
 * AudioProcessor
 * Listens on the microphone and, on each chunk, runs the on-device audio
 * distress model (AudioClassifier) to detect a scream or a shouted distress
 * keyword. Pure on-device inference — no server call.
 *
 * ── IMPORTANT: the raw-PCM bridge ──────────────────────────────────────────
 * The classifier needs a mono Float array of PCM samples (16 kHz, ~3 s). Expo's
 * recorder writes an encoded file (m4a/wav), NOT a raw sample buffer, and there
 * is no pure-JS decoder we can rely on in React Native. So a small native audio
 * *stream* module must feed PCM frames in. Register it once at startup:
 *
 *     audioProcessor.setPcmProvider(async () => myLiveAudioStream.readClip());
 *
 * Good options: `react-native-live-audio-stream` (emits base64 PCM16 chunks you
 * convert to Float in JS) or a tiny native module exposing AVAudioEngine /
 * AudioRecord buffers. Until a provider is set, inference is SKIPPED — the
 * processor never raises a false alarm on random data (the old placeholder did).
 *
 * Migrated from expo-av to expo-audio (SDK 56).
 */

import { AudioModule, RecordingPresets } from 'expo-audio';
import type { AudioRecorder } from 'expo-audio';
import * as ExpoAudio from 'expo-audio';
import { Platform } from 'react-native';
import { useSettingsStore } from '../../store/settingsStore';
import { audioModelLoader } from './AudioModelLoader';
import { pcmAudioBridge } from './PcmAudioBridge';
import type { AudioClass } from './audioModelConfig';

type AudioInferenceCallback = (confidence: number, detectedClass: string) => void;

/** Returns the most recent ~3s of mono PCM (Float ~[-1,1]) at 16 kHz, or null. */
export type PcmProvider = () => Promise<ArrayLike<number> | null>;

// How the model's classes map to the event labels the rest of the app expects.
const CLASS_TO_EVENT: Record<AudioClass, string> = {
  background: 'background_noise',
  speech: 'background_noise',
  scream: 'scream',
  distress_keyword: 'trigger_word',
};

// Minimum emergency-class probability before we notify listeners.
const DISTRESS_THRESHOLD = 0.85;

export class AudioProcessor {
  private isListening = false;
  private recorder: AudioRecorder | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private listeners: Set<AudioInferenceCallback> = new Set();
  private pcmProvider: PcmProvider | null = null;

  /** Register the native raw-PCM source (see file header). */
  public setPcmProvider(provider: PcmProvider | null) {
    this.pcmProvider = provider;
  }

  public async startListening() {
    try {
      if (this.isListening) return;
      if (Platform.OS === 'web') {
        if (__DEV__) console.log('[ML] AudioProcessor is disabled on web.');
        return;
      }

      const permissionResponse = await AudioModule.requestRecordingPermissionsAsync();
      if (!permissionResponse.granted) {
        if (__DEV__) console.warn('[ML] Audio permission not granted');
        return;
      }

      // Default the PCM source to the native mic bridge (unless a custom
      // provider was registered), then start capturing raw audio.
      if (!this.pcmProvider) {
        this.setPcmProvider(() => pcmAudioBridge.getClip());
      }
      const capturing = await pcmAudioBridge.start();
      if (!capturing && __DEV__) {
        console.log('[ML] PCM capture not available on this build — audio inference will idle.');
      }

      // Warm the model so the first inference isn't delayed.
      audioModelLoader.get().catch(() => {});

      this.isListening = true;
      if (__DEV__) console.log('[ML] Started audio processor background listening...');

      // Run inference every 5 seconds (record 3s, process 2s)
      this.intervalId = setInterval(() => {
        this.runInferenceLoop();
      }, 5000);

      // Trigger first run immediately
      this.runInferenceLoop();
    } catch (e) {
      if (__DEV__) console.warn('[ML] AudioProcessor startListening failed:', e);
    }
  }

  public stopListening() {
    try {
      if (this.intervalId) {
        clearInterval(this.intervalId);
        this.intervalId = null;
      }
      if (this.recorder) {
        try {
          this.recorder.stop();
        } catch { /* ignore if already stopped */ }
        this.recorder = null;
      }
      // Stop the native mic capture and clear the buffer.
      pcmAudioBridge.stop();
      this.isListening = false;
      if (__DEV__) console.log('[ML] Stopped audio processor.');
    } catch (e) {
      if (__DEV__) console.warn('[ML] AudioProcessor stopListening error:', e);
    }
  }

  public addListener(callback: AudioInferenceCallback) {
    this.listeners.add(callback);
  }

  public removeListener(callback: AudioInferenceCallback) {
    this.listeners.delete(callback);
  }

  private async runInferenceLoop() {
    if (!this.isListening) return;

    // Check global settings toggle
    const { mlVoiceEnabled } = useSettingsStore.getState();
    if (!mlVoiceEnabled) {
      if (__DEV__) console.log('[ML] Voice inference disabled in settings, skipping chunk.');
      return;
    }

    // Without a raw-PCM source we cannot run the model. Skip quietly — never
    // fabricate a detection (a false SOS is worse than a missed one here).
    if (!this.pcmProvider) {
      if (__DEV__) console.log('[ML] No PCM provider registered — audio inference skipped. See AudioProcessor header.');
      return;
    }

    try {
      const samples = await this.pcmProvider();
      if (!samples || samples.length === 0) return;

      const classifier = await audioModelLoader.get();
      const pred = classifier.predict(samples);

      if (__DEV__) {
        console.log(`[ML] Audio v${classifier.version}: ${pred.label} `
          + `(${(pred.confidence * 100).toFixed(0)}%, emrg ${(pred.emergencyConfidence * 100).toFixed(0)}%)`);
      }

      if (pred.isEmergency && pred.emergencyConfidence >= DISTRESS_THRESHOLD) {
        const event = CLASS_TO_EVENT[pred.label as AudioClass] ?? 'scream';
        this.listeners.forEach((cb) => cb(pred.emergencyConfidence, event));
      } else {
        this.listeners.forEach((cb) => cb(0, 'background_noise'));
      }
    } catch (e) {
      if (__DEV__) console.warn('[ML] AudioProcessor inference error:', e);
    }
  }

  /** QA hook: force a high-confidence detection without real audio. */
  public simulateTrigger(distressClass: 'scream' | 'trigger_word' = 'scream') {
    if (__DEV__) console.log(`[ML] Simulating high-confidence audio detection: ${distressClass}...`);
    this.listeners.forEach((cb) => cb(0.95, distressClass));
  }
}

export const audioProcessor = new AudioProcessor();
