import { FastifyInstance } from 'fastify';
import { Readable } from 'stream';
import { ADMIN_ROOM } from '@/utils/alert-rooms';
import {
  ALLOWED_MEDIA,
  MAX_IMAGE_BYTES,
  MAX_MEDIA_PER_INCIDENT,
  MAX_VIDEO_BYTES,
  VideoLocationScrubber,
  sniffMatches,
  stripImageMetadata,
} from './incident-media';

export class IncidentMediaError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}

export interface MediaPublic {
  id: string;
  incidentId: string;
  type: string;
  mimeType: string;
  sizeBytes: number;
  source: string;
  uploadedAt: Date;
}

const toPublic = (m: any): MediaPublic => ({
  id: m.id,
  incidentId: m.incidentId,
  type: m.type,
  mimeType: m.mimeType,
  sizeBytes: Number(m.sizeBytes),
  source: m.source,
  uploadedAt: m.uploadedAt,
});

/** Read at least n bytes from a stream and put them back, so the stream can still be consumed whole. */
function readHead(stream: Readable, n: number): Promise<{ head: Buffer; ended: boolean }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let len = 0;
    let settled = false;
    const finish = (ended: boolean) => {
      if (settled) return;
      settled = true;
      stream.off('readable', onReadable);
      stream.off('end', onEnd);
      stream.off('error', onError);
      const head = Buffer.concat(chunks);
      if (!ended && head.length) stream.unshift(head);
      resolve({ head, ended });
    };
    const onReadable = () => {
      let c: Buffer | null;
      while (len < n && (c = stream.read()) !== null) {
        chunks.push(c);
        len += c.length;
      }
      if (len >= n) finish(false);
    };
    const onEnd = () => finish(true);
    const onError = (e: Error) => { if (!settled) { settled = true; reject(e); } };
    stream.on('readable', onReadable);
    stream.on('end', onEnd);
    stream.on('error', onError);
    onReadable();
  });
}

async function readAll(stream: Readable, max: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let len = 0;
  // Keep reading past the limit (discarding) so the request body is drained
  // and the client gets a clean 413 instead of a reset connection.
  for await (const c of stream) {
    const b = Buffer.isBuffer(c) ? c : Buffer.from(c);
    len += b.length;
    if (len <= max) chunks.push(b);
  }
  if (len > max || (stream as unknown as { truncated?: boolean }).truncated) {
    throw new IncidentMediaError(413, `Photos can be at most ${Math.round(max / 1024 / 1024)} MB`);
  }
  return Buffer.concat(chunks);
}

export class IncidentMediaService {
  constructor(private readonly fastify: FastifyInstance) {}

  private get prisma() {
    return this.fastify.prisma;
  }

  async add(
    incidentId: string,
    file: { file: Readable; mimetype: string },
    source: 'reporter' | 'admin',
  ): Promise<MediaPublic> {
    const mimeType = (file.mimetype || '').toLowerCase();
    const allowed = ALLOWED_MEDIA[mimeType];
    if (!allowed) {
      file.file.resume();
      throw new IncidentMediaError(415, 'Only JPEG, PNG or WebP photos and MP4, MOV, 3GP or WebM videos can be attached.');
    }

    const incident = await this.prisma.incidentReport.findUnique({
      where: { id: incidentId },
      select: { id: true, _count: { select: { media: true } } },
    });
    if (!incident) {
      file.file.resume();
      throw new IncidentMediaError(404, 'Incident not found');
    }
    if (incident._count.media >= MAX_MEDIA_PER_INCIDENT) {
      file.file.resume();
      throw new IncidentMediaError(409, `A report can have at most ${MAX_MEDIA_PER_INCIDENT} photos or videos.`);
    }

    const n = incident._count.media + 1;
    // Never keep the phone's file name: it often contains a date, a place or a name.
    const storedName = `incident-${incidentId.slice(0, 8)}-${n}${allowed.ext}`;
    const storageMime = mimeType === 'image/jpg' ? 'image/jpeg' : mimeType;

    let stored: { fileKey: string; sizeBytes: number; checksum: string };
    if (allowed.kind === 'photo') {
      const raw = await readAll(file.file, MAX_IMAGE_BYTES);
      if (!sniffMatches(mimeType, raw)) throw new IncidentMediaError(415, 'The file is not a valid image of the stated type.');
      let clean: Buffer;
      try {
        clean = stripImageMetadata(mimeType, raw);
      } catch {
        throw new IncidentMediaError(415, 'The image could not be read. Try another photo.');
      }
      stored = await this.fastify.storage.uploadStream(Readable.from(clean), storedName, storageMime);
    } else {
      const { head, ended } = await readHead(file.file, 12);
      if (!sniffMatches(mimeType, head)) {
        if (!ended) file.file.resume();
        throw new IncidentMediaError(415, 'The file is not a valid video of the stated type.');
      }
      const source$ = ended ? Readable.from(head) : file.file;
      const scrubber = new VideoLocationScrubber();
      source$.pipe(scrubber);
      stored = await this.fastify.storage.uploadStream(scrubber, storedName, storageMime);
      if ((file.file as unknown as { truncated?: boolean }).truncated) {
        await this.fastify.storage.deleteFile(stored.fileKey).catch(() => undefined);
        throw new IncidentMediaError(413, `Videos can be at most ${Math.round(MAX_VIDEO_BYTES / 1024 / 1024)} MB`);
      }
      if (scrubber.scrubbed) this.fastify.log.info({ incidentId, scrubbed: scrubber.scrubbed }, 'Removed location metadata from incident video');
    }

    if (stored.sizeBytes === 0) {
      await this.fastify.storage.deleteFile(stored.fileKey).catch(() => undefined);
      throw new IncidentMediaError(400, 'The file is empty.');
    }

    // Re-check the cap: two uploads may have raced past the first check.
    const row = await this.prisma.$transaction(async (tx) => {
      const count = await tx.incidentMedia.count({ where: { incidentId } });
      if (count >= MAX_MEDIA_PER_INCIDENT) return null;
      return tx.incidentMedia.create({
        data: {
          incidentId,
          type: allowed.kind,
          fileKey: stored.fileKey,
          originalName: storedName,
          mimeType: storageMime,
          sizeBytes: BigInt(stored.sizeBytes),
          checksum: stored.checksum,
          source,
        },
      });
    });
    if (!row) {
      await this.fastify.storage.deleteFile(stored.fileKey).catch(() => undefined);
      throw new IncidentMediaError(409, `A report can have at most ${MAX_MEDIA_PER_INCIDENT} photos or videos.`);
    }

    const media = toPublic(row);
    this.fastify.io?.to(ADMIN_ROOM).emit('incident:media', { incidentId, media });
    return media;
  }

  async list(incidentId: string): Promise<MediaPublic[]> {
    const rows = await this.prisma.incidentMedia.findMany({ where: { incidentId }, orderBy: { uploadedAt: 'asc' } });
    return rows.map(toPublic);
  }

  async open(mediaId: string): Promise<{ stream: Readable; mimeType: string; name: string; size: number }> {
    const m = await this.prisma.incidentMedia.findUnique({ where: { id: mediaId } });
    if (!m) throw new IncidentMediaError(404, 'Media not found');
    try {
      const stream = await this.fastify.storage.getFileStream(m.fileKey);
      return { stream, mimeType: m.mimeType, name: m.originalName, size: Number(m.sizeBytes) };
    } catch {
      throw new IncidentMediaError(404, 'The file is no longer available');
    }
  }

  async remove(mediaId: string): Promise<{ incidentId: string }> {
    const m = await this.prisma.incidentMedia.findUnique({ where: { id: mediaId } });
    if (!m) throw new IncidentMediaError(404, 'Media not found');
    await this.prisma.incidentMedia.delete({ where: { id: mediaId } });
    await this.fastify.storage.deleteFile(m.fileKey).catch((err) =>
      this.fastify.log.warn({ err, mediaId }, 'Could not delete incident media file'),
    );
    return { incidentId: m.incidentId };
  }

  /** Storage keys for an incident's media — removed after the incident row is deleted. */
  async fileKeys(incidentId: string): Promise<string[]> {
    const rows = await this.prisma.incidentMedia.findMany({ where: { incidentId }, select: { fileKey: true } });
    return rows.map((r) => r.fileKey);
  }
}
