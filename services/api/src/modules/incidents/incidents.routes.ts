import { FastifyInstance } from 'fastify';
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
  
  // Public route to get safety score
  fastify.get('/safety-score', { schema: getSafetyScoreSchema }, controller.getSafetyScore);

  // Admin routes (requires police/admin role)
  fastify.register((adminRoutes, _opts, innerDone) => {
    adminRoutes.addHook('onRequest', fastify.authenticate);
    adminRoutes.addHook('onRequest', requireRoles(['police', 'admin']));

    adminRoutes.get('/admin', { schema: adminListIncidentsSchema }, controller.listIncidentsForAdmin);
    adminRoutes.patch('/:id/status', { schema: adminUpdateIncidentStatusSchema }, controller.updateIncidentStatus);
    adminRoutes.patch('/:id', controller.updateIncident);
    adminRoutes.delete('/:id', controller.deleteIncident);

    innerDone();
  });

  done();
}
