/**
 * Contacts Controller
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { ContactsService } from './contacts.service';
import { sendSuccess, sendCreated, buildError } from '@/utils/response';
import { ContactConsentService } from './contact-consent';

export class ContactsController {
  constructor(
    private readonly service: ContactsService,
    private readonly consent: ContactConsentService,
  ) {}

  getContacts = async (
    req: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> => {
    const userId = req.user!.id;
    const contacts = await this.service.getContacts(userId);
    sendSuccess(reply, contacts, 'Contacts retrieved successfully');
  };

  createContact = async (
    req: FastifyRequest<{
      Body: {
        name: string;
        phone: string;
        relation?: string;
        isPrimary?: boolean;
      };
    }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const userId = req.user!.id;
    const contact = await this.service.createContact(userId, req.body);
    sendCreated(reply, contact, 'Contact created successfully');
  };

  updateContact = async (
    req: FastifyRequest<{
      Params: { id: string };
      Body: {
        name?: string;
        phone?: string;
        relation?: string;
        isPrimary?: boolean;
      };
    }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const userId = req.user!.id;
    const contact = await this.service.updateContact(req.params.id, userId, req.body);
    sendSuccess(reply, contact, 'Contact updated successfully');
  };

  deleteContact = async (
    req: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) => {
    await this.service.deleteContact(req.params.id, req.user!.id);
    return reply.status(200).send({
      success: true,
      message: 'Contact deleted successfully',
    });
  };

  requestVerification = async (
    req: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const result = await this.consent.send(req.user!.id, req.params.id);
    sendSuccess(reply, result, 'Consent request sent to the contact by SMS');
  };

  verifyContactGone = async (_req: FastifyRequest, reply: FastifyReply) => {
    return reply.status(410).send(
      buildError(
        'HTTP_410',
        'Contacts can no longer be verified directly. Use POST /contacts/:id/verification: the contact confirms by SMS.',
      ),
    );
  };
}
