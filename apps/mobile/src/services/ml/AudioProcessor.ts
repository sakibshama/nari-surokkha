/**
 * AudioProcessor
 * Processes microphone input and runs inference
 * by sending 3-second audio chunks to the Python ML backend.
 *
 * Migrated from expo-av to expo-audio (SDK 56).
 */

import { AudioModule, RecordingPresets } from 'expo-audio';
import type { AudioRecorder } from 'expo-audio';
import * as ExpoAudio from 'expo-audio';
import { Platform } from 'react-native';
import { useSettingsStore } from '../../store/settingsStore';

type AudioInferenceCallback = (confidence: number, detectedClass: string) => void;

export class AudioProcessor {
  private isListening = false;
  private recorder: AudioRecorder | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private listeners: Set<AudioInferenceCallback> = new Set();
  
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

    try {
      // Stop and release previous recorder if it exists
      if (this.recorder) {
        try {
          this.recorder.stop();
        } catch { /* ignore */ }
        this.recorder = null;
      }

      if (__DEV__) console.log('[ML] Recording 3-second audio chunk...');
      
      // Create a new recorder with high-quality preset.
      // expo-audio exports AudioRecorder as a type only, so grab the runtime
      // constructor from the module namespace defensively.
      const RecorderCtor = (ExpoAudio as any).AudioRecorder;
      if (!RecorderCtor) return;
      const recorder: AudioRecorder = new RecorderCtor(RecordingPresets.HIGH_QUALITY);
      this.recorder = recorder;

      // Start recording
      recorder.record();

      // Record for 3 seconds
      await new Promise(resolve => setTimeout(resolve, 3000));

      if (!this.recorder) return;

      // Stop recording and get the URI
      this.recorder.stop();
      const uri = this.recorder.uri;
      this.recorder = null;

      if (!uri) return;

      if (__DEV__) console.log('[ML] Processing audio chunk locally with TFLite...');

      // TODO: Load real .tflite model using react-native-fast-tflite and pass the audio buffer.
      // For now, we simulate an offline inference result.
      const is_distress = Math.random() > 0.95; // 5% chance in dev testing
      const result = {
        success: true,
        data: {
          is_distress,
          keyword_confidence: is_distress ? 0.8 : 0.1,
          scream_confidence: is_distress ? 0.9 : 0.1,
          detected_word: is_distress ? 'help' : '',
        }
      };

      if (__DEV__) console.log('[ML] Local Inference Result:', result);

      if (result.success && result.data) {
        const { is_distress, keyword_confidence, scream_confidence, detected_word } = result.data;
        
        if (is_distress) {
          if (__DEV__) console.log(`[ML] DISTRESS DETECTED! Keyword: ${detected_word}, Scream Confidence: ${scream_confidence}`);
          
          let eventType = 'background_noise';
          let maxConf = 0;
          
          if (keyword_confidence > scream_confidence) {
            eventType = 'trigger_word';
            maxConf = keyword_confidence;
          } else {
            eventType = 'scream';
            maxConf = scream_confidence;
          }
          
          this.listeners.forEach(cb => cb(maxConf, eventType));
        } else {
          this.listeners.forEach(cb => cb(0, 'background_noise'));
        }
      }

    } catch (e) {
      if (__DEV__) console.warn('[ML] AudioProcessor inference error:', e);
    }
  }

  public simulateTrigger(distressClass: 'scream' | 'trigger_word' = 'scream') {
    if (__DEV__) console.log(`[ML] Simulating high-confidence audio detection: ${distressClass}...`);
    this.listeners.forEach(cb => cb(0.95, distressClass));
  }
}

export const audioProcessor = new AudioProcessor();
