import './helpers';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { base64ToBytes, pcm16ToFloat32, base64Pcm16ToFloat32 } from '../src/services/emergency/pcm';

test('base64 decoder matches Buffer for every length', () => {
  for (let n = 0; n < 64; n++) {
    const bytes = Buffer.from(Array.from({ length: n }, (_, i) => (i * 37 + n) & 0xff));
    const b64 = bytes.toString('base64');
    assert.deepEqual(Buffer.from(base64ToBytes(b64)), bytes);
  }
});

test('PCM16 little-endian → float in [-1, 1)', () => {
  const ints = Int16Array.from([0, 1, -1, 32767, -32768, 16384]);
  const f = pcm16ToFloat32(new Uint8Array(ints.buffer));
  assert.deepEqual(Array.from(f), [0, 1 / 32768, -1 / 32768, 32767 / 32768, -1, 0.5]);
  const f2 = base64Pcm16ToFloat32(Buffer.from(ints.buffer).toString('base64'));
  assert.deepEqual(Array.from(f2), Array.from(f));
});
