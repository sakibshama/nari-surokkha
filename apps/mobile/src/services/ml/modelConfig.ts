/**
 * On-device motion model constants.
 *
 * MUST stay in sync with services/ml-training/config.py. If these change,
 * retrain and re-export the model.
 */

export const SAMPLE_RATE_HZ = 50;
export const WINDOW_SECONDS = 2.0;
export const WINDOW_SIZE = Math.round(SAMPLE_RATE_HZ * WINDOW_SECONDS); // 100

// Per-sample channel order: accelerometer (g) then gyroscope (rad/s)
export const CHANNELS = ['ax', 'ay', 'az', 'gx', 'gy', 'gz'] as const;
export const NUM_CHANNELS = CHANNELS.length;

export const CLASSES = ['normal', 'walking', 'fall', 'struggle'] as const;
export type MotionClass = (typeof CLASSES)[number];
export const EMERGENCY_CLASSES: MotionClass[] = ['fall', 'struggle'];

export const MODEL_KIND = 'motion';
