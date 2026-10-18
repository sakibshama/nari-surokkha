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

/**
 * AudioSet class indices. Verified against the label list embedded in
 * assets/models/yamnet.tflite (yamnet_label_list.txt, 0-based):
 *   0 Speech · 6 Shout · 7 Bellow · 8 Whoop · 9 Yell · 10 Children shouting ·
 *   11 Screaming · 19 Crying, sobbing · 20 Baby cry, infant cry · 21 Whimper ·
 *   22 Wail, moan.
 */
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
 * (YAMNet usually scores an infant's crying as "Crying, sobbing" too, so this
 * only removes windows where the infant label is the sole evidence.)
 */
export const YAMNET_BABY_CRY = 20;

/**
 * Everyday sounds that YAMNet confuses with a shout/scream. When one of them
 * clearly dominates the window (see COMPETITOR_* below) the shout score of
 * that window is ignored: people cheering at a match, children playing,
 * singing along to music, the TV.
 */
export const YAMNET_SHOUT_COMPETITORS = [
  8, // Whoop
  10, // Children shouting
  13, // Laughter
  14, // Baby laughter
  24, // Singing
  25, // Choir
  27, // Chant
  29, // Child singing
  61, // Cheering
  62, // Applause
  64, // Crowd
  66, // Children playing
  132, // Music
  518, // Television
  519, // Radio
] as const;
/** Same idea for crying: laughter is the classic confusion, then music / TV / cats. */
export const YAMNET_CRY_COMPETITORS = [
  13, // Laughter
  14, // Baby laughter
  15, // Giggle
  17, // Belly laugh
  18, // Chuckle, chortle
  24, // Singing
  76, // Cat
  80, // Caterwaul
  132, // Music
  518, // Television
  519, // Radio
] as const;
/** A competitor suppresses a window only if it scores at least this … */
export const COMPETITOR_MIN_SCORE = 0.3;
/** … and at least this many times the trigger's own score (a real scream over music still counts). */
export const COMPETITOR_DOMINANCE = 1.5;

// ── Level gate (efficiency; nothing is lost, see KeywordSpotter) ──
/**
 * 80 ms blocks quieter than this (RMS, dBFS) count as silence. While the last
 * ~2 s held nothing louder, the keyword models do not run at all, and YAMNet
 * windows whose loudest block is below it are not classified (scores = 0).
 * -60 dBFS is below the quietest speech in the evaluation sets; a quiet
 * room on a phone mic sits around -70…-60. Check on a device with the live
 * input meter (EmergencyDetectionScreen) before raising it.
 */
export const GATE_OPEN_DBFS = -60;
/** Level-analysis block (80 ms, = one keyword hop). */
export const LEVEL_BLOCK = 1280;
/**
 * Keyword hops whose audio reaches the newest keyword score: 16 embeddings ×
 * 8 mel frames back + 76-frame embedding window + 480-sample mel context =
 * 25 hops + 480 samples, so 26 whole hops. The spotter keeps this much raw
 * audio so that it can rebuild its state exactly when the gate re-opens.
 */
export const KWS_RECEPTIVE_HOPS = 26;

// ── Shout loudness ──
/**
 * Screams and shouts are loud. A YAMNet "shout" window counts only if its
 * loudest 80 ms block reaches SHOUT_MIN_DBFS and stands SHOUT_MIN_PROMINENCE_DB
 * above the background (NOISE_FLOOR_PERCENTILE of the last NOISE_FLOOR_BLOCKS
 * blocks ≈ 5 s). This removes "shouts" YAMNet hears in quiet, distant or
 * steady sounds (TV across the room, traffic hum) without touching real
 * shouting, which is 20-40 dB above room noise. Both values are deliberately
 * lenient: no recordings of real screaming were available to tune them (see
 * services/ml-training/keywords/REPORT.md) — validate on a device.
 */
export const SHOUT_MIN_DBFS = -45;
export const SHOUT_MIN_PROMINENCE_DB = 6;
export const NOISE_FLOOR_BLOCKS = 64;
export const NOISE_FLOOR_PERCENTILE = 0.1;

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

/**
 * Hysteresis: after firing, a trigger re-arms only once its score has fallen
 * below REARM_RATIO × threshold for a whole rule window (the event is over),
 * or REARM_MAX_MS after it fired (so a cry that never pauses still re-alerts,
 * e.g. after an "I'm okay" cooldown has run out).
 */
export const REARM_RATIO = 0.5;
export const REARM_MAX_MS = 20_000;

/**
 * Combined cues: a keyword cue and a sound cue (shout or cry) that each fall
 * short of their own rule, but both reach their "weak" rule within
 * COMBINE_WINDOW_MS of each other, fire together — "help" plus a scream is far
 * stronger evidence than either alone, and a single weak cue never fires.
 * Weak rule = WEAK_THRESHOLD_RATIO × the trigger's threshold at the chosen
 * sensitivity, reached by WEAK_HITS scores within the rule's window.
 */
export const COMBINE_WINDOW_MS = 3000;
// 0.7 let a laughter recording (cry 0.33 + a "bachao"-like 0.7) combine; 0.8 does not.
export const WEAK_THRESHOLD_RATIO = 0.8;
export const WEAK_HITS: Record<TriggerId, number> = { help: 2, bachao: 2, shout: 1, cry: 2 };
export const KEYWORD_TRIGGERS: readonly TriggerId[] = ['help', 'bachao'];
export const SOUND_TRIGGERS: readonly TriggerId[] = ['shout', 'cry'];

// ── Soft alert ──
export const SOFT_ALERT_SECONDS = 15;
/** After the user says "I'm okay", automatic triggers stay muted this long. */
export const DEFAULT_COOLDOWN_MS = 60_000;
/** Keep at most this many entries in the on-device alert history. */
export const HISTORY_LIMIT = 300;
