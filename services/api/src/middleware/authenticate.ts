/**
 * JWT Authentication Middleware
 *
 * Verifies the Authorization header containing a Bearer JWT access token.
 * Populates req.user with the parsed token payload if valid.
 * Throws UnauthorizedError otherwise.
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { AuthService } from '@/modules/auth/auth.service';
import { AuthRepository } from '@/modules/auth/auth.repository';
import { UnauthorizedError } from '@/utils/errors';
import { isTokenVersionValid } from '@/utils/token-version';

export function setupAuthenticateMiddleware(
  app: import('fastify').FastifyInstance,
): void {
  const authRepo = new AuthRepository(app.prisma);
  const authService = new AuthService(authRepo, app);

  app.decorate(
    'authenticate',
    async (request: FastifyRequest, _reply: FastifyReply) => {
      try {
        const authHeader = request.headers.authorization;
        let token: string | undefined;

        if (authHeader) {
          const [scheme, t] = authHeader.split(' ');
          if (scheme === 'Bearer' && t) {
            token = t;
          } else {
            throw new UnauthorizedError('Invalid Authorization header format');
          }
        }

        if (!token) {
          token = request.cookies.accessToken;
        }

        if (!token) {
          throw new UnauthorizedError('Missing authentication token');
        }

        const payload = authService.verifyAccessToken(token);

        // Role and permissions are baked into the token, so without this check
        // revoking either had no effect until the token expired — up to 15
        // minutes of continued privileged access after the decision to remove
        // it. Fails OPEN if Redis is unreachable (see utils/token-version):
        // a cache outage must never stop someone triggering an SOS.
        const versionValid = await isTokenVersionValid(app, payload.sub, payload.ver);
        if (!versionValid) {
          throw new UnauthorizedError(
            'Your permissions changed. Please sign in again.',
          );
        }

        request.user = {
          id: payload.sub,
          role: payload.role,
          phone: payload.phone,
          permissions: payload.permissions || [],
          stationId: payload.stationId,
          badgeNumber: payload.badgeNumber,
        };
      } catch (err) {
        throw new UnauthorizedError(
          err instanceof Error ? err.message : 'Unauthorized',
        );
      }
    },
  );
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
