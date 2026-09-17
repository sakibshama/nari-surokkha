/**
 * On-device AUDIO model constants.
 *
 * MUST stay in sync with services/ml-training/audio_config.py. If these change,
 * retrain and re-export the model. Note: the mel filterbank and Hann window are
 * NOT duplicated here — they are read from the exported model JSON so the device
 * uses the exact numbers the model was trained with (parity guarantee).
 */

export const SAMPLE_RATE_HZ = 16000;
export const CLIP_SECONDS = 3.0;
export const CLIP_SIZE = Math.round(SAMPLE_RATE_HZ * CLIP_SECONDS); // 48000

export const FRAME_SIZE = 512;
export const HOP_SIZE = 256;
export const N_FFT_BINS = FRAME_SIZE / 2 + 1; // 257
export const N_MEL_BANDS = 8;
export const ROLLOFF_PERCENT = 0.85;
export const EPS = 1e-6;

export const CLASSES = ['background', 'speech', 'scream', 'distress_keyword'] as const;
export type AudioClass = (typeof CLASSES)[number];
export const EMERGENCY_CLASSES: AudioClass[] = ['scream', 'distress_keyword'];

export const MODEL_KIND = 'audio';
