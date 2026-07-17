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
} from './contacts.schemas';

export function contactsRoutes(
  fastify: FastifyInstance,
  _opts: unknown,
  done: (err?: Error) => void,
): void {
  const repo = new ContactsRepository(fastify.prisma);
  const service = new ContactsService(repo);
  const controller = new ContactsController(service);

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

    authRequiredRouter.post(
      '/:id/verify',
      { schema: verifyContactSchema },
      controller.verifyContact,
    );

    innerDone();
  });

  done();
}
