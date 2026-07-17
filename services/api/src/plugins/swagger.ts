/**
 * Swagger / OpenAPI Documentation Plugin.
 *
 * Auto-generates API documentation from route schemas.
 * Only exposed in development and staging — never in production.
 *
 * UI available at: GET /docs
 */

import fp from 'fastify-plugin';
import { FastifyInstance } from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { env } from '@/config/env';

async function swaggerPlugin(fastify: FastifyInstance): Promise<void> {
  if (env.NODE_ENV === 'production') {
    fastify.log.info('Swagger docs disabled in production');
    return;
  }

  await fastify.register(swagger, {
    openapi: {
      openapi: '3.0.0',
      info: {
        title: 'Nari Surokkha API',
        description: 'Women\'s Safety & Emergency Response Platform API',
        version: '1.0.0',
      },
      servers: [
        {
          url: env.API_BASE_URL,
          description: env.NODE_ENV === 'development' ? 'Development' : 'Staging',
        },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
      security: [{ bearerAuth: [] }],
      tags: [
        { name: 'health', description: 'Health check endpoints' },
        { name: 'auth', description: 'Authentication endpoints' },
        { name: 'users', description: 'User profile management' },
        { name: 'contacts', description: 'Trusted contacts' },
        { name: 'alerts', description: 'SOS emergency alerts' },
        { name: 'location', description: 'Live location updates' },
        { name: 'evidence', description: 'Evidence upload' },
        { name: 'cases', description: 'Case management' },
        { name: 'responders', description: 'Responder system' },
        { name: 'admin', description: 'Admin functions' },
      ],
    },
  });

  await fastify.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
    },
  });

  fastify.log.info(`📚 API docs available at ${env.API_BASE_URL}/docs`);
}

export default fp(swaggerPlugin, {
  name: 'swagger',
  fastify: '5.x',
});
