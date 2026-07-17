/**
 * SensorProcessor
 *
 * Thin adapter over MotionMonitor that preserves the original public API
 * (startListening / stopListening / addListener(confidence) / simulateTrigger)
 * used by HomeScreen. Under the hood it now runs the REAL on-device motion
 * model instead of Math.random().
 *
 * The confidence passed to listeners is the emergency confidence (max softmax
 * probability across the fall/struggle classes), so existing threshold logic
 * (e.g. `c > 0.85 => soft alert`) keeps working.
 */

import { motionMonitor } from './MotionMonitor';
import { MotionPrediction } from './MotionClassifier';
import { useSettingsStore } from '../../store/settingsStore';

type InferenceCallback = (confidence: number) => void;

export class SensorProcessor {
  private listeners = new Set<InferenceCallback>();

  private readonly onPrediction = (p: MotionPrediction) => {
    // Respect the user's motion-detection toggle.
    const { mlGyroEnabled } = useSettingsStore.getState();
    if (!mlGyroEnabled) return;
    const confidence = p.isEmergency ? p.emergencyConfidence : 0;
    this.listeners.forEach((cb) => cb(confidence));
  };

  public async startListening(): Promise<void> {
    motionMonitor.addListener(this.onPrediction);
    await motionMonitor.start();
    if (__DEV__) console.log('[ML] SensorProcessor started (on-device model)');
  }

  public stopListening(): void {
    motionMonitor.removeListener(this.onPrediction);
    motionMonitor.stop();
    if (__DEV__) console.log('[ML] SensorProcessor stopped');
  }

  public addListener(callback: InferenceCallback): void {
    this.listeners.add(callback);
  }

  public removeListener(callback: InferenceCallback): void {
    this.listeners.delete(callback);
  }

  /** The latest raw sensor window (for uploading labelled training data). */
  public getLastWindow(): number[][] | null {
    return motionMonitor.getLastWindow();
  }

  public getLastPrediction(): MotionPrediction | null {
    return motionMonitor.getLastPrediction();
  }

  /** Force a high-confidence event for manual testing. */
  public simulateTrigger(): void {
    if (__DEV__) console.log('[ML] Simulating high-confidence motion detection…');
    this.listeners.forEach((cb) => cb(0.95));
  }
}

export const sensorProcessor = new SensorProcessor();
