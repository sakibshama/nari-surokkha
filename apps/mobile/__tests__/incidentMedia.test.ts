import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toAttachment, formatDuration, MAX_VIDEO_BYTES, MAX_IMAGE_BYTES } from '../src/services/incidentMediaCore';

const asset = (o: Record<string, unknown>) => ({ uri: 'file:///x/IMG_1.jpg', width: 10, height: 10, ...o }) as any;

test('attachments: a photo and a video are accepted; the video keeps its duration', () => {
  const p = toAttachment(asset({ type: 'image', mimeType: 'image/jpeg', fileSize: 1000 }));
  assert.equal(typeof p, 'object');
  assert.equal((p as any).kind, 'photo');
  assert.equal((p as any).mimeType, 'image/jpeg');
  const v = toAttachment(asset({ uri: 'file:///x/clip.mov', type: 'video', duration: 12500 }));
  assert.equal((v as any).kind, 'video');
  assert.equal((v as any).mimeType, 'video/quicktime');
  assert.equal((v as any).durationMs, 12500);
});

test('attachments: image/jpg is normalised and the type falls back to the extension', () => {
  assert.equal((toAttachment(asset({ type: 'image', mimeType: 'image/jpg' })) as any).mimeType, 'image/jpeg');
  assert.equal((toAttachment(asset({ uri: 'file:///a/b.png', type: 'image' })) as any).mimeType, 'image/png');
});

test('attachments: HEIC, a video declared as an image, and oversize files are refused', () => {
  assert.equal(toAttachment(asset({ type: 'image', mimeType: 'image/heic' })), 'format');
  assert.equal(toAttachment(asset({ type: 'image', mimeType: 'video/mp4' })), 'format');
  assert.equal(toAttachment(asset({ type: 'video', mimeType: 'video/mp4', fileSize: MAX_VIDEO_BYTES + 1 })), 'too_big');
  assert.equal(toAttachment(asset({ type: 'image', mimeType: 'image/png', fileSize: MAX_IMAGE_BYTES + 1 })), 'too_big');
});

test('attachments: unique keys even for the same file picked twice', () => {
  const a = toAttachment(asset({ type: 'image', mimeType: 'image/jpeg', assetId: 'same' })) as any;
  const b = toAttachment(asset({ type: 'image', mimeType: 'image/jpeg', assetId: 'same' })) as any;
  assert.notEqual(a.key, b.key);
});

test('formatDuration', () => {
  assert.equal(formatDuration(65_000), '1:05');
  assert.equal(formatDuration(null), '');
});
