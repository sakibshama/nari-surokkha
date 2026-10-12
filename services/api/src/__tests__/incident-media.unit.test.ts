/**
 * Incident photos/videos: upload tokens, type checks, location-metadata
 * stripping, and the upload route end to end with in-memory storage.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { Readable } from 'stream';
import crypto from 'crypto';
import Fastify, { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import sensible from '@fastify/sensible';
import {
  createUploadToken, verifyUploadToken, sniffMatches, stripImageMetadata, scrubLocationStrings,
  VideoLocationScrubber, MAX_MEDIA_PER_INCIDENT,
} from '@/modules/incidents/incident-media';
import { incidentsRoutes } from '@/modules/incidents/incidents.routes';

// 16x16 images saved by Pillow with EXIF: Make=TestPhone and a GPS position.
const JPG = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/4QCeRXhpZgAATU0AKgAAAAgAAgEPAAIAAAAKAAAAJoglAAQAAAABAAAAMAAAAABUZXN0UGhvbmUAAAQAAQACAAAAAk4AAAAAAgAFAAAAAwAAAGYAAwACAAAAAkUAAAAABAAFAAAAAwAAAH4AAAAAAAAAFwAAAAEAAAAuAAAAAQAABPgAAAAZAAAAWgAAAAEAAAAZAAAAAQAAAFQAAAAZ/9sAQwADAgIDAgIDAwMDBAMDBAUIBQUEBAUKBwcGCAwKDAwLCgsLDQ4SEA0OEQ4LCxAWEBETFBUVFQwPFxgWFBgSFBUU/9sAQwEDBAQFBAUJBQUJFA0LDRQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQU/8AAEQgAEAAQAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/aAAwDAQACEQMRAD8A8Kooor5o/t0//9k=', 'base64');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAlmVYSWZNTQAqAAAACAACAQ8AAgAAAAoAAAAmiCUABAAAAAEAAAAwAAAAAFRlc3RQaG9uZQAABAABAAIAAAACTgAAAAACAAUAAAADAAAAZgADAAIAAAACRQAAAAAEAAUAAAADAAAAfgAAAAAAAAAXAAAAAQAAAC4AAAABAAAE+AAAABkAAABaAAAAAQAAABkAAAABAAAAVAAAABn9bxVmAAAAGUlEQVR4nGM8IWfDQApgIkn1qIZRDUNKAwCqpQFCIKWWzQAAAABJRU5ErkJggg==', 'base64');
const WEBP = Buffer.from('UklGRugAAABXRUJQVlA4WAoAAAAIAAAADwAADwAAVlA4ICwAAACQAQCdASoQABAAAUAmJaACdLoAA5gA/vD6K67xaUa/+8Z//cZ//cZ/7uAAAEVYSUaWAAAATU0AKgAAAAgAAgEPAAIAAAAKAAAAJoglAAQAAAABAAAAMAAAAABUZXN0UGhvbmUAAAQAAQACAAAAAk4AAAAAAgAFAAAAAwAAAGYAAwACAAAAAkUAAAAABAAFAAAAAwAAAH4AAAAAAAAAFwAAAAEAAAAuAAAAAQAABPgAAAAZAAAAWgAAAAEAAAAZAAAAAQAAAFQAAAAZ', 'base64');
const ID = '3f1e7c3a-1b2c-4d5e-8f90-a1b2c3d4e5f6';

describe('upload tokens', () => {
  it('a token works only for its own incident and only until it expires', () => {
    const { token } = createUploadToken(ID);
    expect(verifyUploadToken(ID, token)).toBe(true);
    expect(verifyUploadToken('00000000-0000-0000-0000-000000000000', token)).toBe(false);
    expect(verifyUploadToken(ID, token, Date.now() + 2 * 3600 * 1000)).toBe(false);
    expect(verifyUploadToken(ID, token.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')))).toBe(false);
    expect(verifyUploadToken(ID, undefined)).toBe(false);
    expect(verifyUploadToken(ID, 'garbage')).toBe(false);
  });
});

describe('type sniffing', () => {
  it('accepts real images and rejects renamed files', () => {
    expect(sniffMatches('image/jpeg', JPG)).toBe(true);
    expect(sniffMatches('image/png', PNG)).toBe(true);
    expect(sniffMatches('image/webp', WEBP)).toBe(true);
    expect(sniffMatches('image/jpeg', PNG)).toBe(false);
    expect(sniffMatches('video/mp4', Buffer.from('<html><script>'))).toBe(false);
    expect(sniffMatches('video/mp4', Buffer.from('\0\0\0\x18ftypmp42', 'latin1'))).toBe(true);
    expect(sniffMatches('video/webm', Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]))).toBe(true);
  });
});

describe('image metadata stripping', () => {
  for (const [name, mime, buf] of [['JPEG', 'image/jpeg', JPG], ['PNG', 'image/png', PNG], ['WebP', 'image/webp', WEBP]] as const) {
    it(`${name}: removes EXIF (camera model and GPS) and stays a valid ${name}`, () => {
      expect(buf.includes('TestPhone')).toBe(true);
      const out = stripImageMetadata(mime, buf);
      expect(out.includes('TestPhone')).toBe(false);
      expect(out.includes('Exif')).toBe(false);
      expect(sniffMatches(mime, out)).toBe(true);
      expect(out.length).toBeLessThan(buf.length);
    });
  }
  it('rejects a corrupt JPEG instead of storing it', () => {
    expect(() => stripImageMetadata('image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff]))).toThrow();
  });
});

describe('video location scrubbing', () => {
  it('blanks ISO-6709 positions and keeps the byte length', () => {
    const buf = Buffer.from('\0\0\0\x1c\xa9xyz\0\x12\x15\xc7+23.7808+090.4176+012.000/\0moov', 'latin1');
    const before = buf.length;
    expect(scrubLocationStrings(buf)).toBe(1);
    expect(buf.length).toBe(before);
    expect(buf.toString('latin1')).toContain('+00.0000+000.0000+000.000/');
    expect(buf.toString('latin1')).not.toContain('23.7808');
  });

  it('catches a position split across stream chunks', async () => {
    const text = 'x'.repeat(5000) + 'com.apple.quicktime.location.ISO6709 +23.780812+090.417645/' + 'y'.repeat(5000);
    const src = Buffer.from(text, 'latin1');
    const chunks = [src.subarray(0, 5030), src.subarray(5030, 5047), src.subarray(5047)];
    const s = new VideoLocationScrubber();
    const out: Buffer[] = [];
    s.on('data', (c) => out.push(c));
    const done = new Promise((r) => s.on('end', r));
    Readable.from(chunks).pipe(s);
    await done;
    const result = Buffer.concat(out);
    expect(result.length).toBe(src.length);
    expect(result.toString('latin1')).not.toContain('23.7808');
    expect(result.toString('latin1')).toContain('+00.000000+000.000000/');
  });

  it('leaves video without a position untouched', () => {
    const buf = crypto.randomBytes(4096);
    const copy = Buffer.from(buf);
    scrubLocationStrings(buf);
    expect(buf.equals(copy)).toBe(true);
  });
});

// ─── Route ────────────────────────────────────────────────────────────────────
function multipartBody(filename: string, mime: string, data: Buffer) {
  const boundary = '----nstest' + crypto.randomBytes(6).toString('hex');
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { payload: Buffer.concat([head, data, tail]), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

describe('POST /incidents/:id/media', () => {
  let app: FastifyInstance;
  const files = new Map<string, Buffer>();
  const media: any[] = [];
  let role = 'citizen';

  beforeAll(async () => {
    const prisma: any = {
      incidentReport: {
        findUnique: vi.fn(async ({ where }: any) => (where.id === ID ? { id: ID, _count: { media: media.length } } : null)),
      },
      incidentMedia: {
        count: vi.fn(async () => media.length),
        create: vi.fn(async ({ data }: any) => {
          const row = { id: crypto.randomUUID(), uploadedAt: new Date(), ...data };
          media.push(row);
          return row;
        }),
        findMany: vi.fn(async () => media),
      },
      $transaction: vi.fn(async (fn: any) => fn(prisma)),
    };
    const storage: any = {
      uploadStream: vi.fn(async (stream: Readable, name: string) => {
        const chunks: Buffer[] = [];
        for await (const c of stream) chunks.push(Buffer.from(c));
        const buf = Buffer.concat(chunks);
        const fileKey = `k/${name}`;
        files.set(fileKey, buf);
        return { fileKey, sizeBytes: buf.length, checksum: crypto.createHash('sha256').update(buf).digest('hex') };
      }),
      deleteFile: vi.fn(async (k: string) => { files.delete(k); }),
    };
    app = Fastify();
    await app.register(sensible);
    await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });
    app.decorate('prisma', prisma);
    app.decorate('storage', storage);
    app.decorate('io', null as any);
    app.decorate('authenticate', async (req: any) => {
      if (!req.headers.authorization) throw app.httpErrors.unauthorized('Missing authentication token');
      req.user = { id: 'admin-1', role };
    });
    await app.register(incidentsRoutes, { prefix: '/incidents' });
    await app.ready();
  });
  afterAll(() => app.close());

  it('reporter with a valid token: photo is stored without its EXIF and under a neutral name', async () => {
    const { token } = createUploadToken(ID);
    const body = multipartBody('IMG_20261012_Rina_home.jpg', 'image/jpeg', JPG);
    const res = await app.inject({ method: 'POST', url: `/incidents/${ID}/media`, headers: { ...body.headers, 'x-upload-token': token }, payload: body.payload });
    expect(res.statusCode).toBe(201);
    const data = res.json().data;
    expect(data.type).toBe('photo');
    expect(data.source).toBe('reporter');
    const [key, stored] = [...files.entries()].at(-1)!;
    expect(key).not.toContain('Rina');
    expect(stored.includes('TestPhone')).toBe(false);
  });

  it('no token and no login: 401', async () => {
    const body = multipartBody('a.jpg', 'image/jpeg', JPG);
    const res = await app.inject({ method: 'POST', url: `/incidents/${ID}/media`, headers: body.headers, payload: body.payload });
    expect(res.statusCode).toBe(401);
  });

  it('a token for another report: 403', async () => {
    const { token } = createUploadToken('00000000-0000-0000-0000-000000000000');
    const body = multipartBody('a.jpg', 'image/jpeg', JPG);
    const res = await app.inject({ method: 'POST', url: `/incidents/${ID}/media`, headers: { ...body.headers, 'x-upload-token': token }, payload: body.payload });
    expect(res.statusCode).toBe(403);
  });

  it('a logged-in citizen cannot add media; an admin can', async () => {
    const body = multipartBody('cctv.mp4', 'video/mp4', Buffer.concat([Buffer.from('\0\0\0\x18ftypmp42', 'latin1'), Buffer.from('+23.7808+090.4176/', 'latin1'), crypto.randomBytes(2000)]));
    role = 'citizen';
    let res = await app.inject({ method: 'POST', url: `/incidents/${ID}/media`, headers: { ...body.headers, authorization: 'Bearer x' }, payload: body.payload });
    expect(res.statusCode).toBe(403);
    role = 'admin';
    res = await app.inject({ method: 'POST', url: `/incidents/${ID}/media`, headers: { ...body.headers, authorization: 'Bearer x' }, payload: body.payload });
    expect(res.statusCode).toBe(201);
    expect(res.json().data).toMatchObject({ type: 'video', source: 'admin', mimeType: 'video/mp4' });
    const stored = [...files.values()].at(-1)!;
    expect(stored.toString('latin1')).not.toContain('23.7808');
  });

  it('rejects a renamed file and an unsupported type', async () => {
    const { token } = createUploadToken(ID);
    let body = multipartBody('x.jpg', 'image/jpeg', Buffer.from('<svg onload=alert(1)>'));
    let res = await app.inject({ method: 'POST', url: `/incidents/${ID}/media`, headers: { ...body.headers, 'x-upload-token': token }, payload: body.payload });
    expect(res.statusCode).toBe(415);
    body = multipartBody('x.svg', 'image/svg+xml', Buffer.from('<svg/>'));
    res = await app.inject({ method: 'POST', url: `/incidents/${ID}/media`, headers: { ...body.headers, 'x-upload-token': token }, payload: body.payload });
    expect(res.statusCode).toBe(415);
  });

  it(`stops at ${MAX_MEDIA_PER_INCIDENT} files per report`, async () => {
    const { token } = createUploadToken(ID);
    let last = 0;
    for (let i = 0; i < MAX_MEDIA_PER_INCIDENT + 1; i++) {
      const body = multipartBody('p.png', 'image/png', PNG);
      const res = await app.inject({ method: 'POST', url: `/incidents/${ID}/media`, headers: { ...body.headers, 'x-upload-token': token }, payload: body.payload });
      last = res.statusCode;
    }
    expect(media.length).toBe(MAX_MEDIA_PER_INCIDENT);
    expect(last).toBe(409);
  });

  it('oversize photo and oversize video get a clean 413 and nothing is kept', async () => {
    media.length = 0;
    const before = files.size;
    const { token } = createUploadToken(ID);
    const bigJpg = Buffer.concat([JPG.subarray(0, 4), Buffer.alloc(11 * 1024 * 1024, 1)]);
    let body = multipartBody('big.jpg', 'image/jpeg', bigJpg);
    let res = await app.inject({ method: 'POST', url: `/incidents/${ID}/media`, headers: { ...body.headers, 'x-upload-token': token }, payload: body.payload });
    expect(res.statusCode).toBe(413);
    const bigMp4 = Buffer.concat([Buffer.from('\0\0\0\x18ftypmp42', 'latin1'), Buffer.alloc(51 * 1024 * 1024, 2)]);
    body = multipartBody('big.mp4', 'video/mp4', bigMp4);
    res = await app.inject({ method: 'POST', url: `/incidents/${ID}/media`, headers: { ...body.headers, 'x-upload-token': token }, payload: body.payload });
    expect(res.statusCode).toBe(413);
    expect(files.size).toBe(before);
    expect(media.length).toBe(0);
  }, 30000);

  it('unknown incident: 404', async () => {
    const other = '11111111-2222-4333-8444-555555555555';
    const { token } = createUploadToken(other);
    const body = multipartBody('p.png', 'image/png', PNG);
    const res = await app.inject({ method: 'POST', url: `/incidents/${other}/media`, headers: { ...body.headers, 'x-upload-token': token }, payload: body.payload });
    expect(res.statusCode).toBe(404);
  });
});
