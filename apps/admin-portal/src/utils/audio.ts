let audioCtx: AudioContext | null = null;
// Becomes true only after the AudioContext has been created AND resumed inside
// a genuine user gesture. Until then we must not create/resume it, otherwise
// the browser logs: "The AudioContext was not allowed to start...".
let unlocked = false;

const AudioContextClass: typeof AudioContext | undefined =
  typeof window !== 'undefined'
    ? window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    : undefined;

/**
 * Create + resume the AudioContext. MUST be called from within a user-gesture
 * event handler (click / keydown / touchstart). Safe to call repeatedly.
 */
const unlockAudio = () => {
  if (!AudioContextClass) return;
  if (!audioCtx) {
    audioCtx = new AudioContextClass();
  }
  if (audioCtx.state === 'suspended') {
    // Inside a user gesture, so this resume is allowed and won't warn.
    audioCtx.resume().then(
      () => { unlocked = true; },
      (err) => {
        if (err?.name !== 'NotAllowedError') console.error('AudioContext resume error:', err);
      },
    );
  } else {
    unlocked = true;
  }
};

// Unlock on the first user interaction anywhere on the page.
if (typeof window !== 'undefined') {
  const handler = () => unlockAudio();
  ['click', 'keydown', 'touchstart'].forEach((evt) => {
    window.addEventListener(evt, handler, { once: true, passive: true });
  });
}

export const playSiren = async () => {
  // If the user hasn't interacted with the page yet, the browser forbids audio.
  // Skip quietly rather than calling resume() outside a gesture (which warns).
  if (!audioCtx || !unlocked || audioCtx.state !== 'running') return;

  try {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.type = 'square';

    const now = audioCtx.currentTime;

    // Siren frequency sweep (High - Low - High - Low)
    osc.frequency.setValueAtTime(800, now);
    osc.frequency.linearRampToValueAtTime(1200, now + 0.3);
    osc.frequency.linearRampToValueAtTime(800, now + 0.6);
    osc.frequency.linearRampToValueAtTime(1200, now + 0.9);
    osc.frequency.linearRampToValueAtTime(800, now + 1.2);
    osc.frequency.linearRampToValueAtTime(1200, now + 1.5);
    osc.frequency.linearRampToValueAtTime(800, now + 1.8);

    // Volume envelope
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.3, now + 0.1);
    gain.gain.setValueAtTime(0.3, now + 1.8);
    gain.gain.linearRampToValueAtTime(0, now + 2.0);

    osc.start(now);
    osc.stop(now + 2.0);
  } catch (err) {
    console.error('Audio playback failed - likely browser autoplay blocked', err);
  }
};
