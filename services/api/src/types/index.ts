/**
 * Nari Surokkha — Shared TypeScript types for the API layer.
 *
 * Extends Fastify types with our custom properties (user, requestId etc.)
 * available on every request after authentication.
 */

import { FastifyRequest } from 'fastify';

// ─── Authenticated User on Request ───────────────────────────

export interface AuthenticatedUser {
  id: string;
  /** Role key (e.g. 'citizen', 'police', 'admin') — carried in the JWT. */
  role: string;
  phone: string;
  permissions: string[];
  stationId?: string;
  badgeNumber?: string;
}

// Extend Fastify's request type so req.user is always typed
declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthenticatedUser;
  }
}

// ─── JWT Payload ──────────────────────────────────────────────

export interface JwtAccessPayload {
  sub: string;        // user id
  /** Role key (e.g. 'citizen', 'police', 'admin'). */
  role: string;
  phone: string;
  permissions: string[];
  stationId?: string;
  badgeNumber?: string;
  type: 'access';
  iat: number;
  exp: number;
}

export interface JwtRefreshPayload {
  sub: string;
  type: 'refresh';
  sessionId: string;
  iat: number;
  exp: number;
}

// ─── Pagination ───────────────────────────────────────────────

export interface PaginationQuery {
  page?: number;
  limit?: number;
}

// ─── Route Handler Context ────────────────────────────────────

export type AuthenticatedRequest = FastifyRequest & {
  user: AuthenticatedUser;  // guaranteed after auth middleware
};
