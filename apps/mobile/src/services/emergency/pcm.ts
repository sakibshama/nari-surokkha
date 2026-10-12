/** Dependency-free PCM helpers (no atob/Buffer polyfill needed in React Native). */

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = (() => {
  const m = new Int16Array(128).fill(-1);
  for (let i = 0; i < B64.length; i++) m[B64.charCodeAt(i)] = i;
  return m;
})();

export function base64ToBytes(b64: string): Uint8Array {
  // Count valid chars first so the output length is exact (no trailing junk).
  let valid = 0;
  for (let i = 0; i < b64.length; i++) {
    const c = b64.charCodeAt(i);
    if (c < 128 && LOOKUP[c] >= 0) valid++;
  }
  const outLen = Math.floor((valid * 3) / 4);
  const out = new Uint8Array(outLen);
  let acc = 0;
  let bits = 0;
  let o = 0;
  for (let i = 0; i < b64.length && o < outLen; i++) {
    const c = b64.charCodeAt(i);
    const v = c < 128 ? LOOKUP[c] : -1;
    if (v < 0) continue;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
  }
  return out;
}

/** Little-endian PCM16 bytes → Float32 in [-1, 1). */
export function pcm16ToFloat32(bytes: Uint8Array): Float32Array {
  const n = bytes.length >> 1;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let v = bytes[2 * i] | (bytes[2 * i + 1] << 8);
    if (v >= 0x8000) v -= 0x10000;
    out[i] = v / 32768;
  }
  return out;
}

export function base64Pcm16ToFloat32(b64: string): Float32Array {
  return pcm16ToFloat32(base64ToBytes(b64));
}
