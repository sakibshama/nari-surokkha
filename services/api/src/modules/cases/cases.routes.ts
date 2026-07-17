import { FastifyInstance } from 'fastify';
import { CasesController } from './cases.controller';
import { CasesService } from './cases.service';
import { CasesRepository } from './cases.repository';
import {
  getCasesSchema,
  updateCaseStatusSchema,
  assignOfficerSchema,
  addNoteSchema,
  getCaseTimelineSchema,
} from './cases.schemas';

export function casesRoutes(
  fastify: FastifyInstance,
  _opts: unknown,
  done: (err?: Error) => void,
): void {
  const repository = new CasesRepository(fastify.prisma);
  const service = new CasesService(repository, fastify);
  const controller = new CasesController(service);

  // All case routes require authentication (police officers only)
  fastify.addHook('onRequest', fastify.authenticate);

  fastify.get('/', { schema: getCasesSchema }, controller.listCases);
  fastify.get('/:id', controller.getCase);
  fastify.get('/:id/timeline', { schema: getCaseTimelineSchema }, controller.getTimeline);
  fastify.patch('/:id/assign', { schema: assignOfficerSchema }, controller.assignOfficer);
  fastify.patch('/:id/status', { schema: updateCaseStatusSchema }, controller.updateStatus);
  fastify.post('/:id/notes', { schema: addNoteSchema }, controller.addNote);
  fastify.get('/:id/report', controller.exportReport);

  done();
}
