/**
 * Settings Routes (admin-only).
 *
 *   GET  /api/v1/settings/sms        → current SMS config (secrets masked)
 *   PUT  /api/v1/settings/sms        → update provider / keys / sender
 *   POST /api/v1/settings/sms/test   → send a test SMS with the saved config
 *
 * Secrets are encrypted at rest and never returned to the client.
 */

import { FastifyInstance } from 'fastify';
import { requireRoles } from '@/middleware/rbac';
import { createSmsProvider } from '@/modules/notifications/providers/sms/sms.factory';
import { SmsConfigUpdate, SmsProviderName } from './settings.types';

const VALID_PROVIDERS: SmsProviderName[] = ['mock', 'twilio', 'bulksmsbd'];

export function settingsRoutes(
  fastify: FastifyInstance,
  _opts: unknown,
  done: (err?: Error) => void,
): void {
  const adminOnly = { onRequest: [fastify.authenticate, requireRoles(['admin'])] };

  // ─── Read SMS config (masked) ───────────────────────────────
  fastify.get('/sms', adminOnly, async (_req, reply) => {
    const data = await fastify.settings.getSmsConfigPublic();
    return reply.send({ success: true, data });
  });

  // ─── Update SMS config ──────────────────────────────────────
  fastify.put('/sms', adminOnly, async (req, reply) => {
    const body = (req.body ?? {}) as SmsConfigUpdate;

    if (body.provider && !VALID_PROVIDERS.includes(body.provider)) {
      return reply.code(400).send({
        success: false,
        error: { message: `provider must be one of: ${VALID_PROVIDERS.join(', ')}` },
      });
    }

    const data = await fastify.settings.updateSmsConfig(body, req.user?.id);
    req.log.info({ userId: req.user?.id, provider: data.provider }, 'SMS config updated');
    return reply.send({ success: true, data });
  });

  // ─── Send a test SMS ────────────────────────────────────────
  fastify.post('/sms/test', adminOnly, async (req, reply) => {
    const body = (req.body ?? {}) as { to?: string };
    const to = (body.to ?? '').trim();
    if (!to) {
      return reply.code(400).send({ success: false, error: { message: 'A "to" phone number is required.' } });
    }

    const cfg = await fastify.settings.getSmsConfig();
    const provider = createSmsProvider(cfg);
    const result = await provider.sendSms(
      to,
      'Nari Surokkha: test message. Your SMS gateway is configured correctly.',
    );

    req.log.info({ userId: req.user?.id, provider: provider.name, success: result.success }, 'SMS test sent');
    return reply.send({ success: result.success, data: { provider: provider.name, ...result } });
  });

  done();
}
