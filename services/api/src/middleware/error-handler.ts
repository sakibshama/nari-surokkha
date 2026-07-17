/**
 * Global Error Handler.
 *
 * Catches ALL errors thrown within route handlers and plugins.
 * Maps them to consistent JSON error responses.
 *
 * Rules for a safety-critical system:
 * - NEVER expose internal error details (stack traces, DB errors) to clients
 * - ALWAYS log the full error server-side for debugging
 * - Map known AppErrors to proper HTTP status codes
 * - Unknown errors → 500 with generic message
 */

import { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { isAppError } from '@/utils/errors';
import { buildError } from '@/utils/response';
import { HTTP_STATUS } from '@nari-surokkha/shared';

export function registerErrorHandler(fastify: FastifyInstance): void {
  fastify.setErrorHandler(
    (error: FastifyError | Error, request: FastifyRequest, reply: FastifyReply) => {
      // ─── Zod Validation Error ─────────────────────────────
      if (error instanceof ZodError) {
        request.log.warn({ err: error, path: request.url }, 'Validation error');
        void reply
          .status(HTTP_STATUS.BAD_REQUEST)
          .send(buildError('VAL_001', 'Validation failed', error.flatten().fieldErrors));
        return;
      }

      // ─── Fastify Validation Error (JSON Schema) ────────────
      // Fastify's own schema validation (statusCode 400)
      if ('statusCode' in error && error.statusCode === 400 && error.validation) {
        request.log.warn({ err: error, path: request.url }, 'Schema validation error');
        void reply
          .status(HTTP_STATUS.BAD_REQUEST)
          .send(buildError('VAL_001', 'Request validation failed', error.validation));
        return;
      }

      // ─── Fastify 429 Rate Limit ────────────────────────────
      if ('statusCode' in error && error.statusCode === 429) {
        void reply
          .status(HTTP_STATUS.TOO_MANY_REQUESTS)
          .send(buildError('SERVER_003', error.message));
        return;
      }

      // ─── Known Application Errors ─────────────────────────
      if (isAppError(error)) {
        // Operational errors are expected — log as warn
        if (error.isOperational) {
          request.log.warn(
            { errCode: error.code, path: request.url },
            error.message,
          );
        } else {
          // Non-operational (e.g., InternalError) — log as error
          request.log.error({ err: error, path: request.url }, error.message);
        }

        void reply.status(error.statusCode).send(
          buildError(error.code, error.message, error.details),
        );
        return;
      }

      // ─── Unknown / Unexpected Error ───────────────────────
      // Log full error details server-side only
      request.log.error(
        { err: error, path: request.url, method: request.method },
        'Unexpected error',
      );

      // Never expose internal error details to clients
      void reply.status(HTTP_STATUS.INTERNAL_ERROR).send(
        buildError('SERVER_001', 'An unexpected error occurred. Please try again.'),
      );
    },
  );

  // ─── 404 Not Found ────────────────────────────────────────
  fastify.setNotFoundHandler((request, reply) => {
    request.log.warn({ path: request.url }, 'Route not found');
    void reply.status(HTTP_STATUS.NOT_FOUND).send(
      buildError('SERVER_002', `Route ${request.method} ${request.url} not found`),
    );
  });
}
