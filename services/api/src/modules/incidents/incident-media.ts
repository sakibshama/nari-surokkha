/**
 * Incident report media — photos and videos attached to an anonymous report.
 *
 * Reports are anonymous (no account), so an upload is authorised by a
 * short-lived token handed back when the report is created, not by a login.
 *
 * Reports are also location-fuzzed for the reporter's privacy, and a phone
 * photo carries the exact GPS position in its EXIF block. So image metadata
 * (EXIF, XMP, IPTC, text chunks) is stripped before anything is stored, and
 * ISO-6709 location strings ("+23.7808+090.4176/") are blanked inside videos.
 */
import crypto from 'crypto';
import { Transform, TransformCallback } from 'stream';
import { env } from '@/config/env';

export const MAX_MEDIA_PER_INCIDENT = 5;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
export const UPLOAD_TOKEN_TTL_SECONDS = 60 * 60;

export type MediaKind = 'photo' | 'video';

export const ALLOWED_MEDIA: Record<string, { kind: MediaKind; ext: string }> = {
  'image/jpeg': { kind: 'photo', ext: '.jpg' },
  'image/jpg': { kind: 'photo', ext: '.jpg' },
  'image/png': { kind: 'photo', ext: '.png' },
  'image/webp': { kind: 'photo', ext: '.webp' },
  'video/mp4': { kind: 'video', ext: '.mp4' },
  'video/quicktime': { kind: 'video', ext: '.mov' },
  'video/3gpp': { kind: 'video', ext: '.3gp' },
  'video/webm': { kind: 'video', ext: '.webm' },
};

// ─── Upload tokens ────────────────────────────────────────────────────────────
const sign = (incidentId: string, exp: number) =>
  crypto.createHmac('sha256', env.JWT_SECRET).update(`incident-media:${incidentId}:${exp}`).digest('base64url');

export function createUploadToken(incidentId: string, now = Date.now()): { token: string; expiresAt: string } {
  const exp = Math.floor(now / 1000) + UPLOAD_TOKEN_TTL_SECONDS;
  return { token: `${exp}.${sign(incidentId, exp)}`, expiresAt: new Date(exp * 1000).toISOString() };
}

export function verifyUploadToken(incidentId: string, token: string | undefined, now = Date.now()): boolean {
  if (!token || typeof token !== 'string') return false;
  const [expStr, sig] = token.split('.');
  const exp = Number(expStr);
  if (!Number.isInteger(exp) || !sig || exp * 1000 < now) return false;
  const expected = Buffer.from(sign(incidentId, exp));
  const given = Buffer.from(sig);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

// ─── Content sniffing ─────────────────────────────────────────────────────────
/** True when the first bytes match the declared type, so a renamed file can't slip through. */
export function sniffMatches(mimeType: string, head: Buffer): boolean {
  const m = mimeType.toLowerCase();
  if (m === 'image/jpeg' || m === 'image/jpg') return head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  if (m === 'image/png') return head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (m === 'image/webp') return head.toString('latin1', 0, 4) === 'RIFF' && head.toString('latin1', 8, 12) === 'WEBP';
  if (m === 'video/webm') return head.length >= 4 && head.readUInt32BE(0) === 0x1a45dfa3;
  if (m === 'video/mp4' || m === 'video/quicktime' || m === 'video/3gpp') {
    const box = head.toString('latin1', 4, 8);
    return ['ftyp', 'moov', 'mdat', 'wide', 'free', 'skip'].includes(box);
  }
  return false;
}

// ─── Image metadata stripping ─────────────────────────────────────────────────
/** JPEG: drop APP1 (EXIF/XMP) and APP13 (IPTC/Photoshop) segments; keep pixels, JFIF and ICC. */
export function stripJpeg(buf: Buffer): Buffer {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error('Not a JPEG');
  const out: Buffer[] = [buf.subarray(0, 2)];
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) throw new Error('Corrupt JPEG');
    // Fill bytes
    while (i < buf.length && buf[i] === 0xff && buf[i + 1] === 0xff) i++;
    const marker = buf[i + 1];
    if (marker === undefined) throw new Error('Corrupt JPEG');
    // Markers without a length
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      out.push(buf.subarray(i, i + 2));
      i += 2;
      continue;
    }
    if (marker === 0xd9) { out.push(buf.subarray(i, i + 2)); i += 2; break; }
    if (i + 4 > buf.length) throw new Error('Corrupt JPEG');
    const len = buf.readUInt16BE(i + 2);
    if (len < 2 || i + 2 + len > buf.length) throw new Error('Corrupt JPEG');
    const seg = buf.subarray(i, i + 2 + len);
    if (marker === 0xda) {
      // Start of scan: the entropy-coded image data follows; copy the rest verbatim.
      out.push(buf.subarray(i));
      i = buf.length;
      break;
    }
    if (marker !== 0xe1 && marker !== 0xed) out.push(seg);
    i += 2 + len;
  }
  return Buffer.concat(out);
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_DROP = new Set(['eXIf', 'tEXt', 'iTXt', 'zTXt', 'tIME']);

/** PNG: drop eXIf and text/time chunks. */
export function stripPng(buf: Buffer): Buffer {
  if (!buf.subarray(0, 8).equals(PNG_SIG)) throw new Error('Not a PNG');
  const out: Buffer[] = [PNG_SIG];
  let i = 8;
  while (i + 12 <= buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.toString('latin1', i + 4, i + 8);
    const end = i + 12 + len;
    if (end > buf.length) throw new Error('Corrupt PNG');
    if (!PNG_DROP.has(type)) out.push(buf.subarray(i, end));
    i = end;
    if (type === 'IEND') break;
  }
  return Buffer.concat(out);
}

/** WebP: drop EXIF and XMP chunks and clear their flags in VP8X. */
export function stripWebp(buf: Buffer): Buffer {
  if (buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WEBP') throw new Error('Not a WebP');
  const chunks: Buffer[] = [];
  let i = 12;
  while (i + 8 <= buf.length) {
    const type = buf.toString('latin1', i, i + 4);
    const len = buf.readUInt32LE(i + 4);
    const end = i + 8 + len + (len % 2);
    if (i + 8 + len > buf.length) throw new Error('Corrupt WebP');
    if (type !== 'EXIF' && type !== 'XMP ') {
      const chunk = Buffer.from(buf.subarray(i, Math.min(end, buf.length)));
      if (type === 'VP8X' && chunk.length > 8) chunk[8] &= ~(0x08 | 0x04);
      chunks.push(chunk);
    }
    i = end;
  }
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(body.length + 4, 4);
  header.write('WEBP', 8, 'latin1');
  return Buffer.concat([header, body]);
}

export function stripImageMetadata(mimeType: string, buf: Buffer): Buffer {
  const m = mimeType.toLowerCase();
  if (m === 'image/jpeg' || m === 'image/jpg') return stripJpeg(buf);
  if (m === 'image/png') return stripPng(buf);
  if (m === 'image/webp') return stripWebp(buf);
  return buf;
}

// ─── Video location scrubbing ─────────────────────────────────────────────────
// ISO 6709 as phones write it: "+23.7808+090.4176+012.000/". Two signed
// decimals with fixed integer widths and at least two fraction digits, then a
// slash — a shape that does not occur by chance in compressed media.
const ISO6709 = /[+-]\d{2}\.\d{2,10}[+-]\d{3}\.\d{2,10}(?:[+-]\d{1,6}(?:\.\d{1,6})?)?\//g;
const HOLD = 64; // longer than any possible match

/** Replace every digit of a location string with 0, keeping its byte length (so box sizes stay valid). */
export function scrubLocationStrings(buf: Buffer): number {
  const text = buf.toString('latin1');
  let n = 0;
  for (const m of text.matchAll(ISO6709)) {
    const start = m.index;
    for (let k = 0; k < m[0].length; k++) {
      const c = buf[start + k];
      if (c >= 0x30 && c <= 0x39) buf[start + k] = 0x30;
    }
    n++;
  }
  return n;
}

/** Streaming version: holds back a small tail so a string split across chunks is still caught. */
export class VideoLocationScrubber extends Transform {
  private tail: Buffer = Buffer.alloc(0);
  public scrubbed = 0;

  _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback): void {
    const buf = Buffer.concat([this.tail, chunk]);
    this.scrubbed += scrubLocationStrings(buf);
    if (buf.length > HOLD) {
      this.push(buf.subarray(0, buf.length - HOLD));
      this.tail = Buffer.from(buf.subarray(buf.length - HOLD));
    } else {
      this.tail = buf;
    }
    cb();
  }

  _flush(cb: TransformCallback): void {
    if (this.tail.length) this.push(this.tail);
    cb();
  }
}
