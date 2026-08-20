/**
 * Evidence storage — streaming, integrity and deletion.
 *
 * These run against the local-disk backend (no S3 credentials in test), which
 * exercises the same code path: the streaming pipeline, the checksum
 * Transform, the path-traversal guard and deletion are all shared.
 *
 * The checksum test matters more than it looks. Evidence of an assault is
 * only useful if you can prove it has not been altered, and the hash is
 * computed while bytes stream past — a subtle ordering bug there would
 * produce a plausible-looking but wrong digest.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Readable } from 'stream';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Fastify, { FastifyInstance } from 'fastify';

let tmpDir: string;
let app: FastifyInstance;

/** Build the storage plugin against a throwaway directory. */
async function buildStorage(): Promise<FastifyInstance> {
  tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'nari-evidence-'));
  process.env['STORAGE_LOCAL_DIR'] = tmpDir;
  process.env['STORAGE_PROVIDER'] = 'local';
  delete process.env['AWS_S3_BUCKET'];
  delete process.env['AWS_ACCESS_KEY_ID'];

  // Imported lazily so the env above is in place before config/env is read.
  const storagePlugin = (await import('@/plugins/storage')).default;
  const instance = Fastify({ logger: false });
  await instance.register(storagePlugin);
  await instance.ready();
  return instance;
}

describe('Evidence storage', () => {
  beforeEach(async () => {
    vi.resetModules();
    app = await buildStorage();
  });

  afterEach(async () => {
    await app?.close();
    if (tmpDir) await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  it('stores a streamed upload and reports its real size', async () => {
    const payload = Buffer.from('a'.repeat(100_000));

    const result = await app.storage.uploadStream(
      Readable.from(payload),
      'evidence.jpg',
      'image/jpeg',
    );

    expect(result.sizeBytes).toBe(payload.length);
    expect(result.fileKey).toMatch(/^evidence\/\d{4}-\d{2}-\d{2}\/[0-9a-f-]{36}\.jpg$/);
  });

  it('computes a checksum matching the exact bytes stored', async () => {
    // Many chunks, so a chunk-ordering bug in the hashing Transform would show.
    const chunks = Array.from({ length: 200 }, (_, i) => Buffer.from(`chunk-${i}-`.repeat(50)));
    const whole = Buffer.concat(chunks);
    const expected = crypto.createHash('sha256').update(whole).digest('hex');

    const result = await app.storage.uploadStream(
      Readable.from(chunks),
      'clip.mp4',
      'video/mp4',
    );

    expect(result.checksum).toBe(expected);
    expect(result.sizeBytes).toBe(whole.length);

    // And the bytes actually on disk hash to the same value.
    const readBack = await app.storage.getFileBuffer(result.fileKey);
    expect(crypto.createHash('sha256').update(readBack).digest('hex')).toBe(expected);
  });

  it('round-trips content exactly', async () => {
    const payload = Buffer.from([0x00, 0xff, 0x10, 0x7f, 0x80, 0x01]); // binary, not text
    const { fileKey } = await app.storage.uploadStream(
      Readable.from(payload),
      'audio.m4a',
      'audio/mp4',
    );

    const readBack = await app.storage.getFileBuffer(fileKey);
    expect(Buffer.compare(readBack, payload)).toBe(0);
  });

  it('streams a download rather than requiring the whole file', async () => {
    const payload = Buffer.from('x'.repeat(50_000));
    const { fileKey } = await app.storage.uploadStream(Readable.from(payload), 'a.bin', 'application/octet-stream');

    const stream = await app.storage.getFileStream(fileKey);
    let received = 0;
    for await (const chunk of stream) received += (chunk as Buffer).length;

    expect(received).toBe(payload.length);
  });

  it('deletes a stored object', async () => {
    const { fileKey } = await app.storage.uploadStream(Readable.from(Buffer.from('gone')), 'x.txt', 'text/plain');

    await app.storage.deleteFile(fileKey);

    await expect(app.storage.getFileBuffer(fileKey)).rejects.toThrow();
  });

  it('deletes many objects and reports the count', async () => {
    const keys: string[] = [];
    for (let i = 0; i < 5; i++) {
      const { fileKey } = await app.storage.uploadStream(
        Readable.from(Buffer.from(`f${i}`)),
        `f${i}.txt`,
        'text/plain',
      );
      keys.push(fileKey);
    }

    expect(await app.storage.deleteFiles(keys)).toBe(5);
  });

  it('deleting nothing is not an error', async () => {
    expect(await app.storage.deleteFiles([])).toBe(0);
  });

  // A file key reaches this layer from the database, but defence in depth:
  // a crafted key must never read or delete outside the evidence directory.
  it('refuses path traversal in a file key', async () => {
    await expect(app.storage.getFileBuffer('../../../../etc/passwd')).rejects.toThrow(/Invalid file key/);
    await expect(app.storage.deleteFile('../../secrets.env')).rejects.toThrow(/Invalid file key/);
  });

  it('reports that this deployment is not on object storage', () => {
    // Local disk works, but it pins the API to one host — the flag is what
    // lets callers and health checks know which mode they are in.
    expect(app.storage.isObjectStorage).toBe(false);
  });
});
