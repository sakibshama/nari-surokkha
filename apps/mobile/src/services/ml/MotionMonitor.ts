/**
 * MotionMonitor — samples the real accelerometer + gyroscope at 50 Hz,
 * keeps a rolling 2-second window, and runs the on-device model on an
 * interval. Emits a MotionPrediction to listeners; the winning emergency
 * confidence is what drives soft-alert logic.
 *
 * Battery note: sensors run only between start() and stop(). The Home screen
 * starts monitoring when active and stops on unmount.
 */

import { Platform } from 'react-native';
import { Accelerometer, Gyroscope } from 'expo-sensors';
import { motionModelLoader } from './ModelLoader';
import { MotionPrediction } from './MotionClassifier';
import { WINDOW_SIZE, SAMPLE_RATE_HZ, NUM_CHANNELS } from './modelConfig';

type PredictionListener = (p: MotionPrediction) => void;

const UPDATE_INTERVAL_MS = Math.round(1000 / SAMPLE_RATE_HZ); // 20ms => 50Hz
const INFERENCE_EVERY_MS = 1000; // classify the latest window once per second

class MotionMonitor {
  private running = false;
  private buffer: number[][] = []; // rolling window of [ax,ay,az,gx,gy,gz]
  private lastGyro: [number, number, number] = [0, 0, 0];
  private accelSub: { remove: () => void } | null = null;
  private gyroSub: { remove: () => void } | null = null;
  private inferenceTimer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<PredictionListener>();
  private lastPrediction: MotionPrediction | null = null;

  isRunning(): boolean {
    return this.running;
  }

  async start(): Promise<void> {
    if (this.running) return;

    // Device sensors aren't available on web (expo-sensors setUpdateInterval /
    // addListener throw there). Motion detection is a native-only feature.
    if (Platform.OS === 'web') {
      if (__DEV__) console.log('[ML] Motion monitoring skipped on web (no device sensors).');
      return;
    }

    // Guard against devices without an accelerometer.
    try {
      const available = await Accelerometer.isAvailableAsync();
      if (!available) {
        if (__DEV__) console.log('[ML] Accelerometer not available on this device.');
        return;
      }
    } catch {
      return;
    }

    this.running = true;
    this.buffer = [];

    // Warm up the model so the first inference is instant.
    motionModelLoader.get().catch(() => {});

    Accelerometer.setUpdateInterval(UPDATE_INTERVAL_MS);
    Gyroscope.setUpdateInterval(UPDATE_INTERVAL_MS);

    this.gyroSub = Gyroscope.addListener(({ x, y, z }: { x: number; y: number; z: number }) => {
      this.lastGyro = [x, y, z];
    });

    this.accelSub = Accelerometer.addListener(({ x, y, z }: { x: number; y: number; z: number }) => {
      // Pair each accel reading with the most recent gyro reading.
      this.buffer.push([x, y, z, this.lastGyro[0], this.lastGyro[1], this.lastGyro[2]]);
      if (this.buffer.length > WINDOW_SIZE) this.buffer.shift();
    });

    this.inferenceTimer = setInterval(() => {
      void this.runInference();
    }, INFERENCE_EVERY_MS);
  }

  stop(): void {
    this.running = false;
    this.accelSub?.remove();
    this.gyroSub?.remove();
    this.accelSub = null;
    this.gyroSub = null;
    if (this.inferenceTimer) {
      clearInterval(this.inferenceTimer);
      this.inferenceTimer = null;
    }
    this.buffer = [];
  }

  addListener(cb: PredictionListener): void {
    this.listeners.add(cb);
  }

  removeListener(cb: PredictionListener): void {
    this.listeners.delete(cb);
  }

  /** A copy of the current window (WINDOW_SIZE x 6), or null if not full yet. */
  getLastWindow(): number[][] | null {
    if (this.buffer.length < WINDOW_SIZE) return null;
    return this.buffer.slice(-WINDOW_SIZE).map((row) => row.slice(0, NUM_CHANNELS));
  }

  getLastPrediction(): MotionPrediction | null {
    return this.lastPrediction;
  }

  private async runInference(): Promise<void> {
    if (this.buffer.length < WINDOW_SIZE) return;
    try {
      const window = this.buffer.slice(-WINDOW_SIZE);
      const classifier = await motionModelLoader.get();
      const prediction = classifier.predict(window);
      this.lastPrediction = prediction;
      this.listeners.forEach((cb) => cb(prediction));
    } catch (e) {
      if (__DEV__) console.warn('[ML] Motion inference failed', e);
    }
  }
}

export const motionMonitor = new MotionMonitor();
