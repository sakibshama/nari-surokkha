let audioCtx: AudioContext | null = null;

const initAudio = () => {
  if (audioCtx && audioCtx.state === 'running') return;
  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  if (AudioContextClass) {
    if (!audioCtx) {
      // Browser might log a warning here if not triggered by a user gesture. This is normal.
      audioCtx = new AudioContextClass();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch((err) => {
        // Silently ignore NotAllowedError as it just means the user hasn't interacted yet
        if (err.name !== 'NotAllowedError') console.error('AudioContext resume error:', err);
      });
    }
  }
};

// Bind to window events to catch the first interaction anywhere on the page
if (typeof window !== 'undefined') {
  ['click', 'keydown', 'touchstart'].forEach(evt => {
    window.addEventListener(evt, initAudio, { once: true, passive: true });
  });
}

export const playSiren = async () => {
  try {
    if (!audioCtx) {
      initAudio();
    }
    
    if (!audioCtx) return;

    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }
    
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
