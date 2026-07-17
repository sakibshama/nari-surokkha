/**
 * ML Routes.
 *
 * Device (authenticated user):
 *   GET  /api/v1/ml/model/active?kind=motion   → active model + download URL
 *   POST /api/v1/ml/samples                     → upload a labelled window
 *
 * Admin:
 *   GET  /api/v1/ml/models?kind=motion          → list registered models
 *   POST /api/v1/ml/models                      → upload a new model (multipart)
 *   POST /api/v1/ml/models/:id/activate         → make a model active (OTA)
 *   GET  /api/v1/ml/samples/export?kind=motion  → export samples for training
 *   GET  /api/v1/ml/samples/stats?kind=motion   → label/source counts
 */

import { FastifyInstance } from 'fastify';
import { MlRepository } from './ml.repository';
import { MlService } from './ml.service';
import { requireRoles } from '@/middleware/rbac';

export function mlRoutes(
  fastify: FastifyInstance,
  _opts: unknown,
  done: (err?: Error) => void,
): void {
  const repo = new MlRepository(fastify.prisma);
  const service = new MlService(repo, fastify);
  const adminOnly = { onRequest: [fastify.authenticate, requireRoles(['admin'])] };
  const authed = { onRequest: [fastify.authenticate] };

  // ─── Device: fetch active model ─────────────────────────────
  fastify.get('/model/active', authed, async (req, reply) => {
    const kind = ((req.query as { kind?: string })?.kind || 'motion').trim();
    try {
      const model = await service.getActiveModel(kind);
      if (!model) {
        return reply.code(404).send({ success: false, error: { message: `No active ${kind} model` } });
      }
      return reply.send({ success: true, data: model });
    } catch (err) {
      // e.g. ml_models table not migrated yet, or storage unavailable.
      // The device treats this as "no update" — never a hard failure.
      req.log.warn({ err }, 'ml/model/active lookup failed; returning 404');
      return reply.code(404).send({ success: false, error: { message: 'Model registry unavailable' } });
    }
  });

  // ─── Device: upload a training sample ───────────────────────
  fastify.post('/samples', authed, async (req, reply) => {
    const body = (req.body ?? {}) as {
      kind?: string;
      label?: string | null;
      source?: string;
      window?: unknown;
      sampleRate?: number;
      deviceInfo?: unknown;
    };
    const result = await service.ingestSample({
      userId: req.user?.id,
      kind: (body.kind || 'motion').trim(),
      label: body.label ?? null,
      source: body.source || 'auto',
      window: body.window,
      sampleRate: body.sampleRate ?? 50,
      deviceInfo: body.deviceInfo,
    });
    return reply.code(201).send({ success: true, data: result });
  });

  // ─── Admin: list models ─────────────────────────────────────
  fastify.get('/models', adminOnly, async (req, reply) => {
    const kind = (req.query as { kind?: string })?.kind?.trim();
    const models = await service.listModels(kind);
    return reply.send({ success: true, data: models });
  });

  // ─── Admin: upload a model (multipart file + fields) ────────
  fastify.post('/models', adminOnly, async (req, reply) => {
    const parts = req.parts();
    let buffer: Buffer | null = null;
    let filename = 'model.json';
    let mimetype = 'application/json';
    const fields: Record<string, string> = {};

    for await (const part of parts) {
      if (part.type === 'file') {
        buffer = await part.toBuffer();
        filename = part.filename || filename;
        mimetype = part.mimetype || mimetype;
      } else {
        fields[part.fieldname] = String(part.value);
      }
    }

    if (!buffer) {
      return reply.code(400).send({ success: false, error: { message: 'Model file is required' } });
    }

    let metadata: unknown = {};
    if (fields.metadata) {
      try {
        metadata = JSON.parse(fields.metadata);
      } catch {
        return reply.code(400).send({ success: false, error: { message: 'metadata must be valid JSON' } });
      }
    } else if (mimetype.includes('json') || filename.endsWith('.json')) {
      // For JSON models the file itself carries the metadata.
      try {
        metadata = JSON.parse(buffer.toString('utf8'));
      } catch {
        /* leave empty */
      }
    }

    const model = await service.uploadModel({
      buffer,
      filename,
      mimetype,
      kind: (fields.kind || 'motion').trim(),
      format: (fields.format || (filename.endsWith('.tflite') ? 'tflite' : 'json')).trim(),
      metadata,
      userId: req.user?.id,
      activate: fields.activate === 'true',
    });

    return reply.code(201).send({ success: true, data: model });
  });

  // ─── Admin: activate a model ────────────────────────────────
  fastify.post('/models/:id/activate', adminOnly, async (req, reply) => {
    const { id } = req.params as { id: string };
    const result = await service.activateModel(id);
    req.log.info({ userId: req.user?.id, modelId: id }, 'ML model activated');
    return reply.send({ success: true, data: result });
  });

  // ─── Admin: export samples for training ─────────────────────
  fastify.get('/samples/export', adminOnly, async (req, reply) => {
    const q = req.query as { kind?: string; labeledOnly?: string; limit?: string };
    const data = await service.exportSamples(
      (q.kind || 'motion').trim(),
      q.labeledOnly === 'true',
      q.limit ? parseInt(q.limit, 10) : 5000,
    );
    return reply.send({ success: true, data });
  });

  // ─── Admin: sample stats ────────────────────────────────────
  fastify.get('/samples/stats', adminOnly, async (req, reply) => {
    const kind = ((req.query as { kind?: string })?.kind || 'motion').trim();
    const data = await service.sampleStats(kind);
    return reply.send({ success: true, data });
  });

  done();
}
