/**
 * CORS / origin handling.
 *
 * The trusted-contact consent page (/c/:token) is served by the API itself
 * and its "I agree" form posts back to the API's own origin. That Origin is
 * not an admin-portal origin, and was rejected with 403 — so a contact who
 * agreed was never marked verified.
 */
import Fastify from 'fastify';
import formbody from '@fastify/formbody';
import { describe, it, expect, afterEach } from 'vitest';
import corsPlugin from '@/plugins/cors';
import { registerErrorHandler } from '@/middleware/error-handler';
import { env } from '@/config/env';

const apps: Array<ReturnType<typeof Fastify>> = [];
afterEach(async () => {
  while (apps.length) await apps.pop()!.close();
});

async function build() {
  const app = Fastify();
  apps.push(app);
  registerErrorHandler(app);
  await app.register(corsPlugin);
  await app.register(formbody);
  app.post('/c/:token/accept', async () => ({ ok: true }));
  app.post('/api/v1/contacts', async () => ({ ok: true }));
  await app.ready();
  return app;
}

const ownOrigin = new URL(env.API_BASE_URL).origin;
const token = 'A'.repeat(43);

describe('CORS', () => {
  it('accepts the consent form posted from the API’s own origin', async () => {
    const app = await build();
    const res = await app.inject({
      method: 'POST',
      url: `/c/${token}/accept`,
      headers: { origin: ownOrigin, 'content-type': 'application/x-www-form-urlencoded' },
      payload: '',
    });
    expect(res.statusCode).toBe(200);
  });

  it('accepts the consent form even when the browser sends another origin header', async () => {
    const app = await build();
    const res = await app.inject({
      method: 'POST',
      url: `/c/${token}/accept`,
      headers: { origin: 'https://evil.example', 'content-type': 'application/x-www-form-urlencoded' },
      payload: '',
    });
    // The token is the credential; the page carries no cookies or auth.
    expect(res.statusCode).toBe(200);
  });

  it('still rejects an unknown origin on the JSON API', async () => {
    const app = await build();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/contacts',
      headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
      payload: '{}',
    });
    expect(res.statusCode).toBe(403);
  });

  it('allows the API’s own origin on the JSON API (same-origin is not CORS)', async () => {
    const app = await build();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/contacts',
      headers: { origin: ownOrigin, 'content-type': 'application/json' },
      payload: '{}',
    });
    expect(res.statusCode).toBe(200);
  });
});
