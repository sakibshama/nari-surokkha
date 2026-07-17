import fp from 'fastify-plugin';
import { FastifyInstance } from 'fastify';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { env } from '@/config/env';
import { getLocalUploadDir, ensureUploadDirWritable } from '@/utils/storage-path';

export interface StoragePlugin {
  uploadFile(fileBuffer: Buffer, originalName: string, mimeType: string): Promise<{ fileKey: string; sizeBytes: number; checksum: string }>;
  getPresignedUrl(fileKey: string, expiresIn?: number): Promise<string>;
}

async function storagePluginInit(fastify: FastifyInstance) {
  // If no bucket is configured, we use a mock service for local development
  const isMock = !env.AWS_S3_BUCKET;
  
  let s3Client: S3Client | null = null;
  
  if (!isMock) {
    s3Client = new S3Client({
      region: env.AWS_REGION || 'ap-south-1',
      credentials: {
        accessKeyId: env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY || '',
      },
      // endpoint could be added here for MinIO
    });
    fastify.log.info('StoragePlugin initialized with S3');
  } else {
    // Local-disk mode: verify the evidence directory is writable NOW so a
    // misconfigured path fails loudly at boot instead of silently dropping
    // evidence when the first SOS comes in.
    const check = ensureUploadDirWritable();
    if (!check.ok) {
      const msg = `Evidence storage directory is not writable: ${check.dir} (${check.error}). Set STORAGE_LOCAL_DIR to a writable path.`;
      if (env.NODE_ENV === 'production') {
        fastify.log.error(msg);
        throw new Error(msg); // fail fast — never boot unable to store evidence
      }
      fastify.log.warn(msg);
    } else {
      fastify.log.info(`[LOCAL STORAGE] Evidence directory ready and writable: ${check.dir}`);
    }
  }

  const storage: StoragePlugin = {
    async uploadFile(fileBuffer: Buffer, originalName: string, mimeType: string) {
      const ext = originalName.split('.').pop() || '';
      const uniqueId = crypto.randomUUID();
      const fileKey = `evidence/${new Date().toISOString().split('T')[0]}/${uniqueId}.${ext}`;
      const sizeBytes = fileBuffer.length;
      
      const hash = crypto.createHash('sha256');
      hash.update(fileBuffer);
      const checksum = hash.digest('hex');

      if (!isMock && s3Client) {
        const command = new PutObjectCommand({
          Bucket: env.AWS_S3_BUCKET!,
          Key: fileKey,
          Body: fileBuffer,
          ContentType: mimeType,
        });
        await s3Client.send(command);
      } else {
        const uploadDir = getLocalUploadDir();
        const filePath = path.join(uploadDir, fileKey);

        // Ensure directory exists
        fs.mkdirSync(path.dirname(filePath), { recursive: true });

        // Write file
        fs.writeFileSync(filePath, fileBuffer);

        fastify.log.info(`[LOCAL STORAGE] Uploaded ${fileKey} to ${uploadDir} (${sizeBytes} bytes) - checksum: ${checksum}`);
      }

      return { fileKey, sizeBytes, checksum };
    },

    async getPresignedUrl(fileKey: string, expiresIn = 900) { // 15 mins default
      if (!isMock && s3Client) {
        const command = new GetObjectCommand({
          Bucket: env.AWS_S3_BUCKET!,
          Key: fileKey,
        });
        return await getSignedUrl(s3Client, command, { expiresIn });
      } else {
        fastify.log.info(`[MOCK S3] Generated signed URL for ${fileKey}`);
        // Return a local API URL that will serve the file. Use the configured
        // API base URL (not a hardcoded localhost) so the link resolves for the
        // browser regardless of host/port. Encode each path SEGMENT but keep
        // the slashes as real separators — encoding them (%2F) breaks Fastify's
        // wildcard route matching and 404s the file.
        const base = env.API_BASE_URL.replace(/\/$/, '');
        const encodedKey = fileKey.split('/').map(encodeURIComponent).join('/');
        return `${base}/api/v1/evidence/mock-s3/${encodedKey}?expires=${Date.now() + expiresIn * 1000}`;
      }
    }
  };

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
