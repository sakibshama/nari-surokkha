/**
 * Contacts Service — Business Logic Layer
 */

import { ContactsRepository } from './contacts.repository';
import { NotFoundError, ConflictError, ForbiddenError } from '@/utils/errors';
import { TrustedContact } from '@prisma/client';

export class ContactsService {
  private readonly MAX_CONTACTS = 5;

  constructor(private readonly repo: ContactsRepository) {}

  async getContacts(userId: string): Promise<TrustedContact[]> {
    return this.repo.getContactsByUserId(userId);
  }

  async createContact(
    userId: string,
    data: {
      name: string;
      phone: string;
      relation?: string;
      isPrimary?: boolean;
    },
  ): Promise<TrustedContact> {
    const count = await this.repo.countContactsByUserId(userId);
    if (count >= this.MAX_CONTACTS) {
      throw new ForbiddenError(`You can only have up to ${this.MAX_CONTACTS} trusted contacts.`);
    }

    const existingContacts = await this.repo.getContactsByUserId(userId);
    const phoneExists = existingContacts.some((c) => c.phone === data.phone);
    if (phoneExists) {
      throw new ConflictError('A contact with this phone number already exists.');
    }

    // If this is the first contact, force it to be primary
    if (count === 0) {
      data.isPrimary = true;
    } else if (data.isPrimary) {
      // If setting as primary, we need to demote the old primary
      const oldPrimary = existingContacts.find((c) => c.isPrimary);
      if (oldPrimary) {
        await this.repo.updateContact(oldPrimary.id, userId, { isPrimary: false });
      }
    }

    return this.repo.createContact({ userId, ...data });
  }

  async updateContact(
    id: string,
    userId: string,
    data: {
      name?: string;
      phone?: string;
      relation?: string;
      isPrimary?: boolean;
    },
  ): Promise<TrustedContact> {
    const contact = await this.repo.getContactById(id, userId);
    if (!contact) {
      throw new NotFoundError('Contact not found.');
    }

    if (data.phone && data.phone !== contact.phone) {
      const existingContacts = await this.repo.getContactsByUserId(userId);
      const phoneExists = existingContacts.some((c) => c.phone === data.phone && c.id !== id);
      if (phoneExists) {
        throw new ConflictError('Another contact with this phone number already exists.');
      }
    }

    if (data.isPrimary && !contact.isPrimary) {
      const existingContacts = await this.repo.getContactsByUserId(userId);
      const oldPrimary = existingContacts.find((c) => c.isPrimary && c.id !== id);
      if (oldPrimary) {
        await this.repo.updateContact(oldPrimary.id, userId, { isPrimary: false });
      }
    }

    // Prevent unsetting primary if it's the only primary and there are other contacts
    if (data.isPrimary === false && contact.isPrimary) {
      const count = await this.repo.countContactsByUserId(userId);
      if (count > 1) {
        throw new ForbiddenError('You must have at least one primary contact. Set another contact as primary first.');
      }
    }

    return this.repo.updateContact(id, userId, data);
  }

  async deleteContact(id: string, userId: string): Promise<void> {
    const contact = await this.repo.getContactById(id, userId);
    if (!contact) {
      throw new NotFoundError('Contact not found.');
    }

    if (contact.isPrimary) {
      const existingContacts = await this.repo.getContactsByUserId(userId);
      const remainingContacts = existingContacts.filter(c => c.id !== id);
      
      if (remainingContacts.length > 0) {
        // Automatically make the oldest remaining contact primary
        const nextPrimary = remainingContacts[0];
        await this.repo.updateContact(nextPrimary.id, userId, { isPrimary: true });
      }
    }

    await this.repo.deleteContact(id, userId);
  }

  async verifyContact(id: string, userId: string): Promise<TrustedContact> {
    const contact = await this.repo.getContactById(id, userId);
    if (!contact) {
      throw new NotFoundError('Contact not found.');
    }

    if (contact.isVerified) {
      return contact;
    }

    return this.repo.updateContact(id, userId, { isVerified: true });
  }
}
