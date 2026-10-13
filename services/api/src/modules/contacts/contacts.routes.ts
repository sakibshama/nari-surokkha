/**
 * Contacts Routes
 */

import { FastifyInstance } from 'fastify';
import { ContactsController } from './contacts.controller';
import { ContactsService } from './contacts.service';
import { ContactsRepository } from './contacts.repository';
import {
  getContactsSchema,
  createContactSchema,
  updateContactSchema,
  deleteContactSchema,
  verifyContactSchema,
  requestVerificationSchema,
} from './contacts.schemas';
import { ContactConsentService } from './contact-consent';

export function contactsRoutes(
  fastify: FastifyInstance,
  _opts: unknown,
  done: (err?: Error) => void,
): void {
  const repo = new ContactsRepository(fastify.prisma);
  const service = new ContactsService(repo);
  const controller = new ContactsController(service, new ContactConsentService(fastify));

  // ─── Authenticated Routes ───────────────────────────────────

  fastify.register((authRequiredRouter, _opts, innerDone) => {
    // Require authentication for all contacts routes
    authRequiredRouter.addHook('onRequest', fastify.authenticate);

    authRequiredRouter.get(
      '/',
      { schema: getContactsSchema },
      controller.getContacts,
    );

    authRequiredRouter.post(
      '/',
      { schema: createContactSchema },
      controller.createContact,
    );

    authRequiredRouter.put(
      '/:id',
      { schema: updateContactSchema },
      controller.updateContact,
    );

    authRequiredRouter.delete(
      '/:id',
      { schema: deleteContactSchema },
      controller.deleteContact,
    );

    // B4: the contact confirms by SMS link; the owner can no longer self-verify.
    authRequiredRouter.post(
      '/:id/verification',
      { schema: requestVerificationSchema, config: { rateLimit: { max: 10, timeWindow: 3_600_000 } } },
      controller.requestVerification,
    );

    // Retired: kept so old app builds get a clear answer instead of a 404.
    authRequiredRouter.patch('/:id/verify', { schema: verifyContactSchema }, controller.verifyContactGone);
    authRequiredRouter.post('/:id/verify', { schema: verifyContactSchema }, controller.verifyContactGone);

    innerDone();
  });

  done();
}
