import { FastifyInstance } from 'fastify';
import { ResponderRepository } from './responder.repository';
import { ResponderService } from './responder.service';
import { ResponderController } from './responder.controller';
import {
  applyResponderSchema,
  applyResponderResponseSchema,
  updateLocationSchema,
  updateLocationResponseSchema,
  updateStatusParamsSchema,
  updateStatusBodySchema,
  updateStatusResponseSchema,
  respondDispatchParamsSchema,
  respondDispatchBodySchema,
  respondDispatchResponseSchema,
  getDispatchesResponseSchema,
  verifyDispatchParamsSchema,
  verifyDispatchResponseSchema
} from './responder.schemas';

export async function responderRoutes(fastify: FastifyInstance) {
  const repository = new ResponderRepository(fastify.prisma);
  const service = new ResponderService(repository, fastify);
  const controller = new ResponderController(service);

  fastify.get('/me', {
    onRequest: [fastify.authenticate],
    schema: {
      tags: ['Responders'],
      summary: 'Get my responder profile',
    }
  }, controller.getMyProfile);

  fastify.post('/apply', {
    onRequest: [fastify.authenticate],
    schema: {
      tags: ['Responders'],
      summary: 'Apply to become a responder',
      body: applyResponderSchema,
      response: { 201: applyResponderResponseSchema }
    }
  }, controller.apply as any);

  fastify.patch('/location', {
    onRequest: [fastify.authenticate],
    schema: {
      tags: ['Responders'],
      summary: 'Update responder location and availability',
      body: updateLocationSchema,
      response: { 200: updateLocationResponseSchema }
    }
  }, controller.updateLocation as any);

  fastify.patch('/:id/status', {
    onRequest: [fastify.authenticate],
    schema: {
      tags: ['Responders'],
      summary: 'Verify or reject a responder application (Admin)',
      params: updateStatusParamsSchema,
      body: updateStatusBodySchema,
      response: { 200: updateStatusResponseSchema }
    }
  }, controller.updateStatus as any);

  fastify.get('/pending', {
    onRequest: [fastify.authenticate],
    schema: {
      tags: ['Responders'],
      summary: 'Get pending responder applications (Admin)'
    }
  }, controller.getPending);

  fastify.get('/dispatches', {
    onRequest: [fastify.authenticate],
    schema: {
      tags: ['Responders'],
      summary: 'Get dispatches assigned to me',
      response: { 200: getDispatchesResponseSchema }
    }
  }, controller.getMyDispatches);

  fastify.patch('/dispatches/:dispatchId/response', {
    onRequest: [fastify.authenticate],
    schema: {
      tags: ['Responders'],
      summary: 'Act on an SOS dispatch: accept | reject | arrive | complete | withdraw',
      description:
        'One conditional state transition. 409 with code DISPATCH_STATE (wrong state / lost race), ' +
        'SOS_ENDED (the SOS was cancelled or resolved) or OWN_ALERT.',
      params: respondDispatchParamsSchema,
      body: respondDispatchBodySchema,
      response: { 200: respondDispatchResponseSchema },
    }
  }, controller.respondToDispatch as any);

  fastify.patch('/dispatch/:dispatchId/verify', {
    onRequest: [fastify.authenticate],
    schema: {
      tags: ['Responders'],
      summary: 'Verify a responder assisted with an SOS dispatch',
      params: verifyDispatchParamsSchema,
      response: { 200: verifyDispatchResponseSchema }
    }
  }, controller.verifyDispatch as any);
}
