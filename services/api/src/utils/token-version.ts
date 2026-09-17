/**
 * Access-token revocation.
 *
 * The problem
 * -----------
 * Role and permissions are baked into the access token at sign time. Revoking
 * an admin's `manage_users` permission, suspending an account, or demoting a
 * user therefore had no effect until their token expired — up to 15
 * minutes of continued privileged access after the decision to remove it. For
 * a system that dispatches responders and exposes victims' live locations, that
 * window is not acceptable.
 *
 * The approach
 * ------------
 * A monotonic version number per user, held in Redis. It is stamped into every
 * access token as `ver`, and checked on every authenticated request. Changing a
 * user's role, permissions or status bumps the version, which instantly
 * invalidates every token already issued to them.
 *
 * Redis rather than a database column, deliberately: this is read on every
 * single request, and a Postgres round trip per request would undo the point of
 * stateless JWTs entirely.
 *
 * Failure mode
 * ------------
 * If Redis is unreachable, this **fails open** — the request proceeds on the
 * token's own signature and expiry. That is a considered trade-off: this is an
 * emergency application, and a cache outage must not stop someone triggering an
 * SOS. The exposure is bounded by the 15-minute access-token lifetime, and
 * refresh (which is database-backed) still fails closed.
 */

import type { FastifyInstance } from 'fastify';

const key = (userId: string) => `authver:${userId}`;

/** Version 0 means "never revoked" — the default for every user. */
export const DEFAULT_TOKEN_VERSION = 0;

/** Current token version for a user. Returns 0 when unknown or unreachable. */
export async function getTokenVersion(
  fastify: FastifyInstance,
  userId: string,
): Promise<number> {
  try {
    const raw = await fastify.redis.get(key(userId));
    return raw ? Number(raw) || DEFAULT_TOKEN_VERSION : DEFAULT_TOKEN_VERSION;
  } catch (err) {
    fastify.log.warn({ err, userId }, 'token version read failed — failing open');
    return DEFAULT_TOKEN_VERSION;
  }
}

/**
 * Invalidate every access token currently held by this user.
 *
 * Call after any change to role, permissions, status, or on detected refresh
 * token reuse.
 */
export async function bumpTokenVersion(
  fastify: FastifyInstance,
  userId: string,
): Promise<number> {
  try {
    const next = await fastify.redis.incr(key(userId));
    // No expiry: a version that expires would silently re-validate old tokens.
    fastify.log.info({ userId, version: next }, 'Access tokens revoked for user');
    return next;
  } catch (err) {
    // Log loudly — a failed revocation is a security event, not a warning.
    fastify.log.error({ err, userId }, 'FAILED to revoke access tokens for user');
    return DEFAULT_TOKEN_VERSION;
  }
}

/**
 * Is the version carried by this token still current?
 *
 * Tokens issued before this feature shipped have no `ver` claim; they are
 * accepted until they expire, so deploying does not sign everyone out.
 */
export async function isTokenVersionValid(
  fastify: FastifyInstance,
  userId: string,
  tokenVersion: number | undefined,
): Promise<boolean> {
  const current = await getTokenVersion(fastify, userId);
  if (current === DEFAULT_TOKEN_VERSION) return true;
  if (tokenVersion === undefined) return false; // pre-versioning token, user has since been revoked
  return tokenVersion >= current;
}
