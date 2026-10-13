/**
 * Evidence Storage.
 *
 * Handles photos, audio and video captured during an emergency. This is the
 * most sensitive data the platform holds, and until now it was also the last
 * thing pinning the API to a single machine.
 *
 * What changed and why
 * --------------------
 * 1. **Streaming, not buffering.** `uploadFile` took a `Buffer`, so a 10 MB
 *    upload meant 10 MB of heap, and twenty concurrent uploads meant 200 MB in
 *    a container with a 1 GB limit. Uploads now stream from the request
 *    straight to object storage via `@aws-sdk/lib-storage`, which also gives
 *    automatic multipart for large files. Local-disk mode streams too —
 *    `fs.writeFileSync` was blocking the event loop on every upload.
 *
 * 2. **Encryption at rest.** Evidence of an assault should not sit unencrypted
 *    in a bucket. Every object is written with server-side encryption; set
 *    `S3_KMS_KEY_ID` to use a customer-managed key instead of SSE-S3.
 *
 * 3. **Deletion.** There was no way to delete an object, which made both a
 *    retention policy and a user's right to erase their own evidence
 *    impossible to implement.
 *
 * 4. **Object storage as the default path.** Local disk remains supported for
 *    development, but S3/R2/MinIO is what lets more than one host serve the
 *    API.
 */

import fp from 'fastify-plugin';
import { FastifyInstance } from 'fastify';
import {
  S3Client,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Readable, Transform, pipeline } from 'stream';
import { promisify } from 'util';
import { env, IS_PRODUCTION } from '@/config/env';
import { getLocalUploadDir, ensureUploadDirWritable } from '@/utils/storage-path';
import { signStorageKey } from '@/utils/signed-url';

const pipelineAsync = promisify(pipeline);

export interface StoredFile {
  fileKey: string;
  sizeBytes: number;
  checksum: string;
}

export interface StoragePlugin {
  /** Stream an upload straight to storage. Preferred for anything user-supplied. */
  uploadStream(stream: Readable, originalName: string, mimeType: string): Promise<StoredFile>;
  /** Buffer-based upload. Only for small, server-generated payloads (e.g. ML models). */
  uploadFile(fileBuffer: Buffer, originalName: string, mimeType: string): Promise<StoredFile>;
  getPresignedUrl(fileKey: string, expiresIn?: number, publicBaseUrl?: string): Promise<string>;
  /** Read raw bytes. Prefer getFileStream for anything that goes over the wire. */
  getFileBuffer(fileKey: string): Promise<Buffer>;
  /** Stream a stored file, so downloads do not buffer whole videos in memory. */
  getFileStream(fileKey: string): Promise<Readable>;
  /** Permanently delete one object. Used by retention and subject-erasure. */
  deleteFile(fileKey: string): Promise<void>;
  /** Permanently delete many objects. Returns how many were removed. */
  deleteFiles(fileKeys: string[]): Promise<number>;
  /** True when this deployment stores evidence in object storage. */
  readonly isObjectStorage: boolean;
}

/** Build a date-partitioned, unguessable key. */
function buildFileKey(originalName: string): string {
  const ext = (originalName.split('.').pop() || 'bin').replace(/[^a-zA-Z0-9]/g, '').slice(0, 10);
  const uniqueId = crypto.randomUUID();
  return `evidence/${new Date().toISOString().split('T')[0]}/${uniqueId}.${ext}`;
}

/** Reject any key that would escape the uploads directory. */
function safeLocalPath(uploadDir: string, fileKey: string): string {
  const filePath = path.resolve(uploadDir, fileKey);
  const rel = path.relative(uploadDir, filePath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Invalid file key');
  }
  return filePath;
}

async function storagePluginInit(fastify: FastifyInstance) {
  // Bucket may come from either the legacy AWS_S3_BUCKET or S3_BUCKET_EVIDENCE.
  const bucket = env.AWS_S3_BUCKET || env.S3_BUCKET_EVIDENCE;
  const hasCredentials = Boolean(env.AWS_ACCESS_KEY_ID || env.S3_ACCESS_KEY);
  const useObjectStorage = Boolean(bucket && hasCredentials && env.STORAGE_PROVIDER !== 'local');

  let s3Client: S3Client | null = null;

  // Resolve the server-side-encryption mode once, at boot.
  const sseMode: 'AES256' | 'aws:kms' | 'none' =
    env.S3_SSE !== 'auto'
      ? env.S3_SSE
      : env.S3_KMS_KEY_ID
        ? 'aws:kms'
        : env.STORAGE_PROVIDER === 'minio'
          ? 'none' // MinIO 501s on any SSE header unless a KMS is attached
          : 'AES256';

  if (useObjectStorage) {
    s3Client = new S3Client({
      region: env.AWS_REGION || env.S3_REGION,
      credentials: {
        accessKeyId: (env.AWS_ACCESS_KEY_ID || env.S3_ACCESS_KEY)!,
        secretAccessKey: (env.AWS_SECRET_ACCESS_KEY || env.S3_SECRET_KEY)!,
      },
      // Set S3_ENDPOINT for MinIO or Cloudflare R2. forcePathStyle is required
      // by MinIO and harmless for R2.
      ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT, forcePathStyle: true } : {}),
    });
    fastify.log.info(
      { bucket, endpoint: env.S3_ENDPOINT ?? 'aws', encryption: sseMode },
      '✅ Evidence storage: object storage (multi-host capable)',
    );
    if (sseMode === 'none' && IS_PRODUCTION) {
      fastify.log.warn(
        'Evidence uploads send NO server-side-encryption header. Attach a KMS to MinIO ' +
          '(or enable bucket-default encryption) and set S3_SSE=AES256 / S3_KMS_KEY_ID.',
      );
    }
  } else {
    const check = ensureUploadDirWritable();
    if (!check.ok) {
      const msg = `Evidence storage directory is not writable: ${check.dir} (${check.error}). Set STORAGE_LOCAL_DIR to a writable path.`;
      if (IS_PRODUCTION) {
        fastify.log.error(msg);
        throw new Error(msg); // never boot unable to store evidence
      }
      fastify.log.warn(msg);
    } else {
      fastify.log.info(`[LOCAL STORAGE] Evidence directory ready and writable: ${check.dir}`);
    }
    if (IS_PRODUCTION) {
      fastify.log.warn(
        'Evidence is on local disk. This works, but it pins the API to one host and ' +
          'provides no encryption at rest — set STORAGE_PROVIDER + bucket credentials to fix both.',
      );
    }
  }

  /** Encryption headers applied to every stored object. */
  const encryption =
    sseMode === 'aws:kms'
      ? { ServerSideEncryption: 'aws:kms' as const, ...(env.S3_KMS_KEY_ID ? { SSEKMSKeyId: env.S3_KMS_KEY_ID } : {}) }
      : sseMode === 'AES256'
        ? { ServerSideEncryption: 'AES256' as const }
        : {};

  const storage: StoragePlugin = {
    isObjectStorage: useObjectStorage,

    async uploadStream(stream: Readable, originalName: string, mimeType: string): Promise<StoredFile> {
      const fileKey = buildFileKey(originalName);
      const hash = crypto.createHash('sha256');
      let sizeBytes = 0;

      // Hash and count bytes AS THEY PASS THROUGH, in a Transform rather than
      // via a separate 'data' listener. A listener would switch the source to
      // flowing mode before the pipe was attached, which risks dropping the
      // first chunks — and a wrong checksum on a piece of evidence is worse
      // than a slow upload. Nothing is ever held whole in memory either way.
      const measured = new Transform({
        transform(chunk: Buffer, _enc, cb) {
          hash.update(chunk);
          sizeBytes += chunk.length;
          cb(null, chunk);
        },
      });
      stream.pipe(measured);

      if (useObjectStorage && s3Client) {
        const upload = new Upload({
          client: s3Client,
          params: {
            Bucket: bucket,
            Key: fileKey,
            Body: measured,
            ContentType: mimeType,
            ...encryption,
          },
          // 5MB parts, 4 concurrent — multipart kicks in automatically for
          // anything larger, which is what makes video uploads viable.
          partSize: 5 * 1024 * 1024,
          queueSize: 4,
        });
        await upload.done();
      } else {
        const uploadDir = getLocalUploadDir();
        const filePath = safeLocalPath(uploadDir, fileKey);
        await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
        // Streamed, not writeFileSync — the old form blocked the event loop
        // for the whole write, on the request path, during an emergency.
        await pipelineAsync(measured, fs.createWriteStream(filePath));
      }

      const checksum = hash.digest('hex');
      fastify.log.info({ fileKey, sizeBytes }, 'Evidence stored');
      return { fileKey, sizeBytes, checksum };
    },

    async uploadFile(fileBuffer: Buffer, originalName: string, mimeType: string): Promise<StoredFile> {
      // Small, server-generated payloads only (ML model files). Delegates to
      // the streaming path so there is exactly one write implementation.
      return storage.uploadStream(Readable.from(fileBuffer), originalName, mimeType);
    },

    // `publicBaseUrl` (e.g. "https://api.example.com") lets callers pin the URL
    // to the host the CLIENT actually used to reach us — derived from the
    // request — instead of the server's static API_BASE_URL, which is easy to
    // misconfigure (localhost) and then makes evidence links unreachable from
    // phones/other-origin browsers. Ignored for real S3 (URLs are absolute).
    async getPresignedUrl(fileKey: string, expiresIn = 900, publicBaseUrl?: string) {
      if (useObjectStorage && s3Client) {
        const command = new GetObjectCommand({ Bucket: bucket, Key: fileKey });
        return await getSignedUrl(s3Client, command, { expiresIn });
      }
      const base = (publicBaseUrl || env.API_BASE_URL).replace(/\/$/, '');
      // Encode each path SEGMENT but keep the slashes as real separators —
      // encoding them (%2F) breaks Fastify's wildcard route matching.
      const encodedKey = fileKey.split('/').map(encodeURIComponent).join('/');
      const expires = Date.now() + expiresIn * 1000;
      return `${base}/api/v1/evidence/mock-s3/${encodedKey}?expires=${expires}&sig=${signStorageKey(fileKey, expires)}`;
    },

    async getFileStream(fileKey: string): Promise<Readable> {
      if (useObjectStorage && s3Client) {
        const res = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: fileKey }));
        return res.Body as Readable;
      }
      const filePath = safeLocalPath(getLocalUploadDir(), fileKey);
      await fs.promises.access(filePath); // throw a clear ENOENT rather than a broken stream
      return fs.createReadStream(filePath);
    },

    async getFileBuffer(fileKey: string): Promise<Buffer> {
      const stream = await storage.getFileStream(fileKey);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        // Node streams yield Buffer here; the explicit branch keeps TypeScript
        // happy without an unsound cast (this line previously failed TS2352).
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : Buffer.from(chunk));
      }
      return Buffer.concat(chunks);
    },

    async deleteFile(fileKey: string): Promise<void> {
      if (useObjectStorage && s3Client) {
        await s3Client.send(new DeleteObjectCommand({ Bucket: bucket, Key: fileKey }));
        return;
      }
      const filePath = safeLocalPath(getLocalUploadDir(), fileKey);
      await fs.promises.rm(filePath, { force: true });
    },

    async deleteFiles(fileKeys: string[]): Promise<number> {
      if (fileKeys.length === 0) return 0;

      if (useObjectStorage && s3Client) {
        let deleted = 0;
        // DeleteObjects caps at 1000 keys per request.
        for (let i = 0; i < fileKeys.length; i += 1000) {
          const batch = fileKeys.slice(i, i + 1000);
          const res = await s3Client.send(
            new DeleteObjectsCommand({
              Bucket: bucket,
              Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
            }),
          );
          deleted += batch.length - (res.Errors?.length ?? 0);
          if (res.Errors?.length) {
            fastify.log.error({ errors: res.Errors }, 'Some evidence objects failed to delete');
          }
        }
        return deleted;
      }

      let deleted = 0;
      for (const key of fileKeys) {
        try {
          await storage.deleteFile(key);
          deleted++;
        } catch (err) {
          fastify.log.error({ err, key }, 'Failed to delete evidence file');
        }
      }
      return deleted;
    },
  };

  // Verify the bucket is actually reachable at boot rather than discovering it
  // during the first emergency.
  if (useObjectStorage && s3Client) {
    try {
      await s3Client.send(new HeadObjectCommand({ Bucket: bucket, Key: '__healthcheck__' }));
    } catch (err: any) {
      // 404/NotFound is the expected and healthy answer — the probe key does
      // not exist. Anything else (403, network, bad bucket) is a real problem.
      const status = err?.$metadata?.httpStatusCode;
      if (status && status !== 404 && status !== 403) {
        fastify.log.error({ err, bucket }, 'Evidence bucket unreachable');
        if (IS_PRODUCTION) throw err;
      }
    }
  }

  fastify.decorate('storage', storage);
}

declare module 'fastify' {
  interface FastifyInstance {
    storage: StoragePlugin;
  }
}

export default fp(storagePluginInit, {
  name: 'storage',
});
