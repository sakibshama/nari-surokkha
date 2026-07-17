/**
 * Settings Plugin.
 *
 * Decorates the Fastify instance with a shared SettingsService so routes,
 * the SMS webhook, and the notification worker can all read/write the
 * runtime SMS provider configuration.
 *
 * Depends on the database plugin (fastify.prisma).
 *
 * Usage: fastify.settings.getSmsConfig()
 */

import fp from 'fastify-plugin';
import { FastifyInstance } from 'fastify';
import { SettingsService } from '@/modules/settings/settings.service';
import { isEncryptionConfigured } from '@/utils/crypto-secret';
import { env } from '@/config/env';

declare module 'fastify' {
  interface FastifyInstance {
    settings: SettingsService;
  }
}

async function settingsPlugin(fastify: FastifyInstance): Promise<void> {
  const service = new SettingsService(fastify.prisma);
  fastify.decorate('settings', service);

  // Loud warning: without an encryption key, admins cannot store SMS
  // secrets. Fail hard in production so misconfiguration is caught early.
  if (!isEncryptionConfigured()) {
    const msg =
      'CONFIG_ENCRYPTION_KEY is not set — SMS provider secrets cannot be saved from the Admin Portal.';
    if (env.NODE_ENV === 'production') {
      fastify.log.error(msg);
    } else {
      fastify.log.warn(msg);
    }
  }
}

export default fp(settingsPlugin, {
  name: 'settings',
  dependencies: ['database'],
  fastify: '5.x',
});
