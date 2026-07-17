/**
 * Role-Based Access Control (RBAC) Middleware Factory
 *
 * Enforces that the authenticated user has one of the required roles.
 * Must be used AFTER the authenticate middleware.
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { ForbiddenError, UnauthorizedError } from '@/utils/errors';

export function requireRoles(roles: string[]) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      throw new UnauthorizedError('Authentication required');
    }

    const userRole = request.user.role;

    if (!roles.includes(userRole)) {
      throw new ForbiddenError(
        'You do not have permission to perform this action',
      );
    }
  };
}

export function requirePermissions(permissions: string[]) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      throw new UnauthorizedError('Authentication required');
    }

    // Admins need to have ALL requested permissions to proceed
    const userPermissions = (request.user as any).permissions || [];
    
    for (const p of permissions) {
      if (!userPermissions.includes(p)) {
        throw new ForbiddenError(
          `You lack the required permission to perform this action: ${p}`,
        );
      }
    }
  };
}
