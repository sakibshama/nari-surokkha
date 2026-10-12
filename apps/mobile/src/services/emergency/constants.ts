/**
 * On-device emergency sound detection — constants shared by the detector,
 * the settings UI and the tests.
 *
 * Two independent models run on the microphone stream:
 *
 *  1. Sound events (Shout, Cry) — Google's YAMNet, an AudioSet classifier
 *     (521 classes, 0.975 s window). We read only the classes listed below.
 *
 *  2. Keywords ("Help", "Bachao"/বাঁচাও) — Google's speech-embedding model
 *     (the openWakeWord front-end) feeding a small classifier head trained for
 *     this app. See services/ml-training/keywords/ for how the head is built
 *     and evaluated.
 *
 * Everything is 16 kHz mono float PCM in [-1, 1].
 */

export const SAMPLE_RATE = 16000;

// ── Keyword front-end (must match services/ml-training/keywords/feats.py) ──
/** New samples consumed per keyword step (80 ms). */
export const KWS_HOP = 1280;
/** Extra left context the mel model needs so that 1280 new samples give 8 frames. */
export const KWS_CONTEXT = 480;
/** Input length of the fixed-shape mel model. */
export const KWS_MEL_INPUT = KWS_HOP + KWS_CONTEXT; // 1760
export const KWS_MEL_FRAMES_PER_HOP = 8;
export const KWS_MEL_BINS = 32;
/** Mel frames per embedding window (760 ms). */
export const KWS_EMB_WINDOW = 76;
export const KWS_EMB_DIM = 96;
/** Embeddings per classifier window (16 × 80 ms = 1.28 s). */
export const KWS_HEAD_WINDOW = 16;
/** Audio is scaled to the int16 range before the mel model (openWakeWord convention). */
export const KWS_INPUT_SCALE = 32767;

// ── YAMNet ──
export const YAMNET_INPUT = 15600; // 0.975 s
/** Run YAMNet every 0.5 s on the newest 0.975 s. */
export const YAMNET_HOP = 8000;
export const YAMNET_CLASSES = 521;

/** AudioSet class indices (yamnet_class_map.csv). */
export const YAMNET_SPEECH = 0;
export const YAMNET_SHOUT_CLASSES = [
  6, // Shout
  7, // Bellow
  9, // Yell
  11, // Screaming
] as const;
export const YAMNET_CRY_CLASSES = [
  19, // Crying, sobbing
  21, // Whimper
  22, // Wail, moan
] as const;
/**
 * "Baby cry, infant cry" (20) is deliberately NOT a trigger: a baby crying at
 * home would raise an alert every evening. Adult crying/sobbing still is.
 */
export const YAMNET_BABY_CRY = 20;

// ── Triggers ──
export type TriggerId = 'shout' | 'help' | 'cry' | 'bachao';
export const TRIGGERS: TriggerId[] = ['shout', 'help', 'cry', 'bachao'];

export type Sensitivity = 'low' | 'medium' | 'high';

/**
 * Decision rule per trigger: fire when at least `hits` of the last `window`
 * scores are ≥ threshold. Keyword scores arrive every 80 ms, YAMNet scores
 * every 500 ms, so the windows mean different durations.
 *
 * Keyword values come from the held-out evaluation in
 * services/ml-training/keywords/REPORT.md; YAMNet values from real recordings
 * and held-out speech (same report). "medium" is the default.
 */
export interface TriggerRule {
  threshold: number;
  hits: number;
  window: number;
}

export const TRIGGER_RULES: Record<TriggerId, Record<Sensitivity, TriggerRule>> = {
  help: {
    low: { threshold: 0.95, hits: 3, window: 4 },
    medium: { threshold: 0.9, hits: 3, window: 4 },
    high: { threshold: 0.8, hits: 2, window: 4 },
  },
  bachao: {
    low: { threshold: 0.95, hits: 3, window: 4 },
    medium: { threshold: 0.9, hits: 3, window: 4 },
    high: { threshold: 0.8, hits: 2, window: 4 },
  },
  shout: {
    low: { threshold: 0.6, hits: 2, window: 3 },
    medium: { threshold: 0.4, hits: 2, window: 3 },
    high: { threshold: 0.3, hits: 1, window: 1 },
  },
  cry: {
    low: { threshold: 0.6, hits: 4, window: 5 },
    medium: { threshold: 0.45, hits: 3, window: 5 },
    high: { threshold: 0.3, hits: 2, window: 4 },
  },
};

/** After a trigger fires it stays quiet for this long (one shout = one event). */
export const TRIGGER_REFRACTORY_MS = 8000;

// ── Soft alert ──
export const SOFT_ALERT_SECONDS = 15;
/** After the user says "I'm okay", automatic triggers stay muted this long. */
export const DEFAULT_COOLDOWN_MS = 60_000;
/** Keep at most this many entries in the on-device alert history. */
export const HISTORY_LIMIT = 300;
