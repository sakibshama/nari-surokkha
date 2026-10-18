/**
 * CORS Plugin.
 *
 * Configured for the admin portal origin(s) only.
 * Never open CORS to '*' — this is a safety-critical system.
 */

import fp from 'fastify-plugin';
import { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { env } from '@/config/env';
import { ForbiddenError } from '@/utils/errors';

/**
 * Payment gateway callbacks are top-level browser navigations (SSLCommerz POSTs
 * a form from its own domain) or server-to-server calls. They are not CORS
 * requests, but the browser still sends an Origin header on the form POST,
 * which the origin check below would reject with 403 — losing the payment
 * result. They carry no cookies or tokens and every one is verified with the
 * gateway server-to-server, so the Origin header is simply ignored for them.
 */
const PAYMENT_CALLBACK = /^\/api\/v1\/subscriptions\/(sslcommerz|stripe)\//;

/**
 * Public token pages served by the API itself (trusted-contact consent /c/,
 * live tracking /t/). Their forms post back to the API's OWN origin, so the
 * browser sends `Origin: https://api.<domain>` — which is not an admin-portal
 * origin, and was rejected with 403. That is why a contact who tapped
 * "I agree" was never marked verified. Same-origin requests are not CORS at
 * all; the unguessable token is the credential.
 */
const PUBLIC_TOKEN_PAGE = /^\/(c|t)\/[A-Za-z0-9_-]+(\/|$)/;

/** The API's own origin (scheme + host), e.g. https://api.example.com. */
function ownOrigin(): string | null {
  try {
    return new URL(env.API_BASE_URL).origin;
  } catch {
    return null;
  }
}

async function corsPlugin(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('onRequest', (request, _reply, done) => {
    if (PAYMENT_CALLBACK.test(request.url) || PUBLIC_TOKEN_PAGE.test(request.url)) delete request.headers.origin;
    done();
  });
  await fastify.register(cors, {
    // Allow configured origins + null origin (React Native mobile apps don't
    // send an Origin header, so the browser/native runtime sends origin=null)
    origin: (origin, cb) => {
      if (
        !origin ||
        env.CORS_ORIGINS.includes('*') ||
        env.CORS_ORIGINS.includes(origin) ||
        origin === ownOrigin() // same-origin: a page served by this API
      ) {
        cb(null, true);
      } else {
        // A ForbiddenError, not a bare Error.
        //
        // A plain Error is not an AppError, so the global handler treated a
        // rejected cross-origin request as an UNEXPECTED failure: HTTP 500,
        // logged at error level, and (once Sentry was wired up) reported as an
        // incident. A browser calling from an origin we do not allow is a
        // routine, expected refusal — it should be a 403.
        //
        // The status code matters beyond tidiness: every scanner and
        // misconfigured client would otherwise inflate the 5xx rate and page
        // someone through the ApiErrorRateHigh alert rule.
        cb(new ForbiddenError(`Origin '${origin}' is not allowed`), false);
      }
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    // The portals send cache-busting headers on polling requests, so these
    // must be in the preflight allow-list or the browser blocks the request.
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Request-ID',
      // Authorises photo/video uploads to an anonymous incident report.
      'X-Upload-Token',
      'Cache-Control',
      'Pragma',
      'Expires',
      // The mobile client sends these on every request so it works through an
      // ngrok / localtunnel tunnel. On Expo web they trigger a preflight, so
      // they must be allowed here or every API call is blocked by CORS.
      'ngrok-skip-browser-warning',
      'Bypass-Tunnel-Reminder',
    ],
    exposedHeaders: ['X-Request-ID'],
    credentials: true,
    // Preflight cache: 24 hours
    maxAge: 86400,
  });
}

export default fp(corsPlugin, {
  name: 'cors',
  fastify: '5.x',
});
