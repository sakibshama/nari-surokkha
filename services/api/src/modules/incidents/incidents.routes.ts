import { FastifyInstance, FastifyReply } from 'fastify';
import { IncidentsController } from './incidents.controller';
import { IncidentsService } from './incidents.service';
import { IncidentsRepository } from './incidents.repository';
import {
  submitIncidentSchema,
  adminListIncidentsSchema,
  adminUpdateIncidentStatusSchema,
  getSafetyScoreSchema
} from './incidents.schemas';
import { requireRoles } from '@/middleware/rbac';
import { IncidentMediaService, IncidentMediaError } from './incident-media.service';
import { MAX_VIDEO_BYTES, verifyUploadToken } from './incident-media';

export function incidentsRoutes(
  fastify: FastifyInstance,
  _options: any,
  done: () => void,
) {
  const repository = new IncidentsRepository(fastify.prisma);
  const service = new IncidentsService(repository, fastify);
  const controller = new IncidentsController(service);

  // Public/Anonymous route to submit an incident
  fastify.post(
    '/', 
    { 
      schema: submitIncidentSchema,
      config: {
        rateLimit: {
          max: 5,           // Max 5 incident reports per window
          timeWindow: 3600000 // per 1 hour
        }
      }
    }, 
    controller.submitIncident
  );
  
  const media = new IncidentMediaService(fastify);
  const mediaFail = (reply: FastifyReply, err: unknown) => {
    if (err instanceof IncidentMediaError) {
      return reply.code(err.statusCode).send({ success: false, error: { message: err.message }, message: err.message });
    }
    throw err;
  };
  const isAdmin = (role?: string) => role === 'admin' || role === 'superadmin';

  // Attach a photo or video to a report. The reporter (no account) proves it is
  // their report with the upload token returned by POST /incidents; an admin
  // can add media with a normal login.
  fastify.post<{ Params: { id: string } }>(
    '/:id/media',
    {
      schema: {
        tags: ['incidents'],
        summary: 'Attach a photo or video to an incident report',
        consumes: ['multipart/form-data'],
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
      },
      config: { rateLimit: { max: 20, timeWindow: 3600000 } },
    },
    async (req, reply) => {
      const token = req.headers['x-upload-token'];
      let source: 'reporter' | 'admin';
      if (typeof token === 'string' && token) {
        if (!verifyUploadToken(req.params.id, token)) {
          return reply.code(403).send({ success: false, error: { message: 'This upload link has expired. Submit the report again to attach media.' } });
        }
        source = 'reporter';
      } else {
        await fastify.authenticate(req, reply);
        if (!isAdmin(req.user?.role)) {
          return reply.code(403).send({ success: false, error: { message: 'Only admins can add media to a report.' } });
        }
        source = 'admin';
      }

      const part = await req.file({ limits: { fileSize: MAX_VIDEO_BYTES, files: 1 }, throwFileSizeLimit: false });
      if (!part) return reply.code(400).send({ success: false, error: { message: 'No file uploaded' } });
      try {
        const data = await media.add(req.params.id, part, source);
        req.log.info({ incidentId: req.params.id, mediaId: data.id, type: data.type, source }, 'Incident media uploaded');
        return reply.code(201).send({ success: true, data });
      } catch (e) {
        return mediaFail(reply, e);
      }
    },
  );

  // Public route to get safety score
  fastify.get('/safety-score', { schema: getSafetyScoreSchema }, controller.getSafetyScore);

  // Admin routes (requires admin role)
  fastify.register((adminRoutes, _opts, innerDone) => {
    adminRoutes.addHook('onRequest', fastify.authenticate);
    adminRoutes.addHook('onRequest', requireRoles(['admin', 'superadmin']));

    adminRoutes.get('/admin', { schema: adminListIncidentsSchema }, controller.listIncidentsForAdmin);
    adminRoutes.patch('/:id/status', { schema: adminUpdateIncidentStatusSchema }, controller.updateIncidentStatus);
    adminRoutes.patch('/:id', controller.updateIncident);
    adminRoutes.delete('/:id', controller.deleteIncident);

    // Media (admin only): list, stream, delete
    adminRoutes.get<{ Params: { id: string } }>('/:id/media', async (req, reply) => {
      return reply.send({ success: true, data: await media.list(req.params.id) });
    });
    adminRoutes.get<{ Params: { mediaId: string } }>('/media/:mediaId/raw', async (req, reply) => {
      try {
        const f = await media.open(req.params.mediaId);
        req.log.info({ mediaId: req.params.mediaId, userId: req.user?.id }, 'Incident media viewed');
        return reply
          .header('Content-Type', f.mimeType)
          .header('Content-Length', String(f.size))
          .header('Content-Disposition', `inline; filename="${f.name.replace(/[^\w.-]/g, '_')}"`)
          .header('Cache-Control', 'private, no-store')
          .header('X-Content-Type-Options', 'nosniff')
          .send(f.stream);
      } catch (e) {
        return mediaFail(reply, e);
      }
    });
    adminRoutes.delete<{ Params: { mediaId: string } }>('/media/:mediaId', async (req, reply) => {
      try {
        const r = await media.remove(req.params.mediaId);
        req.log.info({ mediaId: req.params.mediaId, incidentId: r.incidentId, userId: req.user?.id }, 'Incident media deleted');
        return reply.send({ success: true });
      } catch (e) {
        return mediaFail(reply, e);
      }
    });

    innerDone();
  });

  done();
}
