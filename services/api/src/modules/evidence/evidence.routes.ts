import { FastifyInstance } from 'fastify';
import path from 'path';
import fs from 'fs';
import { getLocalUploadDir } from '@/utils/storage-path';
import { EvidenceRepository } from './evidence.repository';
import { EvidenceService } from './evidence.service';
import { EvidenceController } from './evidence.controller';
import {
  uploadEvidenceParamsSchema,
  uploadEvidenceResponseSchema,
  listEvidenceParamsSchema,
  listEvidenceResponseSchema,
  getEvidenceUrlParamsSchema,
} from './evidence.schemas';

export async function evidenceRoutes(fastify: FastifyInstance) {
  const repository = new EvidenceRepository(fastify.prisma);
  const service = new EvidenceService(repository, fastify);
  const controller = new EvidenceController(service);

  // POST /api/v1/alerts/:id/evidence (Note: Mounted inside /api/v1/evidence prefix but we need /api/v1/alerts/:id/evidence or /api/v1/evidence/alerts/:id)
  // Wait, I registered it as /evidence in app.ts. So it's /api/v1/evidence/...
  // Let's use /api/v1/evidence/alerts/:id for upload and list, and /api/v1/evidence/:id/url for url.

  fastify.post(
    '/alerts/:id',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['Evidence'],
        summary: 'Upload evidence for an alert',
        consumes: ['multipart/form-data'],
        params: uploadEvidenceParamsSchema,
        response: {
          201: uploadEvidenceResponseSchema,
        },
      },
    },
    controller.uploadEvidence as any,
  );

  // Right to erasure: the uploader deleting their own evidence. Blocked while
  // a police case is open against the alert (see EvidenceService).
  fastify.delete(
    '/:id',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['Evidence'],
        summary: 'Permanently delete your own evidence',
        description:
          'Removes the stored file and its database record. Refused with 409 while a ' +
          'police case is still open against the alert. The deletion is audit-logged.',
      },
    },
    controller.deleteEvidence as any,
  );

  // Personal evidence library — the caller's own evidence across all alerts.
  // Registered before the '/:id/url' param route; distinct path, no conflict.
  fastify.get(
    '/my',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['Evidence'],
        summary: "List the current user's personal evidence library",
      },
    },
    controller.listMyEvidence as any,
  );

  fastify.get(
    '/alerts/:id',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['Evidence'],
        summary: 'List evidence for an alert',
        params: listEvidenceParamsSchema,
        response: {
          200: listEvidenceResponseSchema,
        },
      },
    },
    controller.listEvidence as any,
  );

  fastify.get(
    '/:id/url',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['Evidence'],
        summary: 'Get pre-signed URL to view evidence',
        params: getEvidenceUrlParamsSchema,
        // No strict response schema — lets the raw { url, expiresIn } object pass through
      },
    },
    controller.getEvidenceUrl as any,
  );

  // Stream the raw bytes (access-controlled) — the reliable path for the app.
  fastify.get(
    '/:id/raw',
    {
      onRequest: [fastify.authenticate],
      schema: {
        tags: ['Evidence'],
        summary: 'Stream raw evidence file bytes',
        params: getEvidenceUrlParamsSchema,
      },
    },
    controller.getRaw as any,
  );

  // MOCK S3 route for serving local files in development
  fastify.get('/mock-s3/*', async (request, reply) => {
    const fileKey = decodeURIComponent((request.params as any)['*']);
    const uploadDir = getLocalUploadDir();
    // Resolve and confine to uploadDir — reject any path-traversal attempt
    // (e.g. '../../etc/passwd') that would escape the uploads directory.
    const filePath = path.resolve(uploadDir, fileKey);
    const relative = path.relative(uploadDir, filePath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      return reply.code(400).send({ error: 'Invalid file path' });
    }

    if (fs.existsSync(filePath)) {
      request.log.info(`[LOCAL STORAGE] Serving evidence: ${filePath}`);
      const stream = fs.createReadStream(filePath);

      // Basic MIME type inference from extension
      const ext = path.extname(fileKey).toLowerCase();
      let mimeType = 'application/octet-stream';
      if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg';
      else if (ext === '.png') mimeType = 'image/png';
      else if (ext === '.mp4') mimeType = 'video/mp4';
      else if (ext === '.webm') mimeType = 'video/webm';
      else if (ext === '.m4a') mimeType = 'audio/mp4';
      reply
        .header('Cross-Origin-Resource-Policy', 'cross-origin')
        .type(mimeType)
        .send(stream);
    } else {
      request.log.warn(`[LOCAL STORAGE] Evidence NOT FOUND on disk: ${filePath} (uploadDir=${uploadDir})`);
      reply.code(404).send({ error: 'File not found' });
    }
  });
}
