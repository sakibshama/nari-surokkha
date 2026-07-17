/**
 * Contacts Controller
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { ContactsService } from './contacts.service';
import { sendSuccess, sendCreated } from '@/utils/response';

export class ContactsController {
  constructor(private readonly service: ContactsService) {}

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

  verifyContact = async (
    req: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) => {
    const contact = await this.service.verifyContact(req.params.id, req.user!.id);
    return reply.status(200).send({
      success: true,
      message: 'Contact verified successfully',
      data: contact,
    });
  };
}
