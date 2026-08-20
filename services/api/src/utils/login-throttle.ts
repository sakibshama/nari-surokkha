/**
 * Per-account login throttling.
 *
 * The existing protection was `RATE_LIMIT_LOGIN_MAX: 5` keyed on IP. That
 * stops one machine hammering the login endpoint; it does nothing against
 * credential stuffing from a botnet, where each attempt against a given
 * account arrives from a different address. And since the global limiter is
 * now user-keyed for *authenticated* requests, login — which by definition has
 * no valid token yet — still falls back to IP.
 *
 * So this tracks failures against the ACCOUNT being targeted, wherever the
 * attempts come from, and backs off exponentially.
 *
 * Two deliberate design choices:
 *
 *  - **Backoff, not a hard lock.** A permanent lockout would let an attacker
 *    who knows someone's phone number lock them out of an emergency app on
 *    purpose. That trade is unacceptable here: the delay grows, but it always
 *    expires, and it is capped.
 *  - **Fails open.** If Redis is unreachable the login proceeds on password
 *    verification alone. Argon2id with the configured parameters is a genuine
 *    barrier by itself, and refusing all logins during a cache outage would
 *    lock every user out of a safety app.
 */

import type { FastifyInstance } from 'fastify';
import { nationalDigits } from './phone';

/** Failures before any delay is applied. */
const FREE_ATTEMPTS = 5;
/** Counter lifetime — failures older than this stop counting. */
const WINDOW_SECONDS = 15 * 60;
/** Never delay longer than this, however many failures. */
const MAX_LOCK_SECONDS = 15 * 60;

const attemptsKey = (id: string) => `login:fail:${id}`;
const lockKey = (id: string) => `login:lock:${id}`;

/**
 * Normalise the account identifier so "01712345678" and "+8801712345678"
 * share one counter — otherwise an attacker just alternates formats.
 */
function identityKey(identifier: string): string {
  const national = nationalDigits(identifier);
  return national || identifier.trim().toLowerCase();
}

export interface ThrottleState {
  locked: boolean;
  /** Seconds until the next attempt is permitted. */
  retryAfterSeconds: number;
  failures: number;
}

/** Delay after `failures` consecutive failures: 0,0,0,0,0,2,4,8,16… capped. */
function backoffSeconds(failures: number): number {
  if (failures <= FREE_ATTEMPTS) return 0;
  const over = failures - FREE_ATTEMPTS;
  return Math.min(2 ** over, MAX_LOCK_SECONDS);
}

/** Is this account currently backing off? Call before verifying the password. */
export async function checkLoginThrottle(
  fastify: FastifyInstance,
  identifier: string,
): Promise<ThrottleState> {
  const id = identityKey(identifier);
  try {
    const [ttl, failuresRaw] = await Promise.all([
      fastify.redis.ttl(lockKey(id)),
      fastify.redis.get(attemptsKey(id)),
    ]);
    const failures = Number(failuresRaw) || 0;
    if (ttl > 0) {
      return { locked: true, retryAfterSeconds: ttl, failures };
    }
    return { locked: false, retryAfterSeconds: 0, failures };
  } catch (err) {
    // Fail open — see the note at the top of this file.
    fastify.log.warn({ err }, 'login throttle check failed; allowing attempt');
    return { locked: false, retryAfterSeconds: 0, failures: 0 };
  }
}

/**
 * Record a failed login and apply the next backoff step.
 * Returns the delay now in force, in seconds.
 */
export async function recordLoginFailure(
  fastify: FastifyInstance,
  identifier: string,
): Promise<number> {
  const id = identityKey(identifier);
  try {
    const failures = await fastify.redis.incr(attemptsKey(id));
    // Refresh the window on every failure so a slow drip still accumulates.
    await fastify.redis.expire(attemptsKey(id), WINDOW_SECONDS);

    const delay = backoffSeconds(failures);
    if (delay > 0) {
      await fastify.redis.set(lockKey(id), '1', 'EX', delay);
      fastify.log.warn(
        { account: id, failures, delaySeconds: delay },
        'Login backoff applied after repeated failures',
      );
    }
    return delay;
  } catch (err) {
    fastify.log.warn({ err }, 'login failure not recorded (redis unavailable)');
    return 0;
  }
}

/** Clear the counters after a successful login. */
export async function clearLoginFailures(
  fastify: FastifyInstance,
  identifier: string,
): Promise<void> {
  const id = identityKey(identifier);
  try {
    await fastify.redis.del(attemptsKey(id), lockKey(id));
  } catch {
    /* best-effort */
  }
}
