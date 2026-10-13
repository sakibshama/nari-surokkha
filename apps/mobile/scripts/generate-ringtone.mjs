/**
 * Writes assets/sounds/ringtone.wav: a 2-second, loopable dual-tone ring
 * (400 Hz + 450 Hz, "ring-ring" cadence), 16 kHz mono 16-bit PCM.
 * Run once: node scripts/generate-ringtone.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RATE = 16000;
const SECONDS = 2;
const FADE = 0.01; // 10 ms fades: no clicks at burst edges or at the loop point
// [start, end] of each tone burst, in seconds; silence elsewhere.
const BURSTS = [
  [0.0, 0.4],
  [0.6, 1.0],
];

const n = RATE * SECONDS;
const pcm = Buffer.alloc(n * 2);
for (let i = 0; i < n; i++) {
  const t = i / RATE;
  const burst = BURSTS.find(([a, b]) => t >= a && t < b);
  let v = 0;
  if (burst) {
    const [a, b] = burst;
    const env = Math.min(1, (t - a) / FADE, (b - t) / FADE);
    v = env * 0.45 * (Math.sin(2 * Math.PI * 400 * t) + Math.sin(2 * Math.PI * 450 * t));
  }
  pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), i * 2);
}

const header = Buffer.alloc(44);
header.write('RIFF', 0);
header.writeUInt32LE(36 + pcm.length, 4);
header.write('WAVE', 8);
header.write('fmt ', 12);
header.writeUInt32LE(16, 16); // PCM chunk size
header.writeUInt16LE(1, 20); // PCM
header.writeUInt16LE(1, 22); // mono
header.writeUInt32LE(RATE, 24);
header.writeUInt32LE(RATE * 2, 28); // byte rate
header.writeUInt16LE(2, 32); // block align
header.writeUInt16LE(16, 34); // bits per sample
header.write('data', 36);
header.writeUInt32LE(pcm.length, 40);

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'sounds', 'ringtone.wav');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, Buffer.concat([header, pcm]));
console.log(`wrote ${out} (${header.length + pcm.length} bytes)`);
