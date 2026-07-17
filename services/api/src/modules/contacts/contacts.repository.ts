/**
 * Contacts Repository — Database Access Layer
 */

import { PrismaClient, TrustedContact } from '@prisma/client';

export class ContactsRepository {
  constructor(private readonly db: PrismaClient) {}

  async getContactsByUserId(userId: string): Promise<TrustedContact[]> {
    return this.db.trustedContact.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async getContactById(id: string, userId: string): Promise<TrustedContact | null> {
    return this.db.trustedContact.findFirst({
      where: { id, userId },
    });
  }

  async countContactsByUserId(userId: string): Promise<number> {
    return this.db.trustedContact.count({
      where: { userId },
    });
  }

  async createContact(data: {
    userId: string;
    name: string;
    phone: string;
    relation?: string;
    isPrimary?: boolean;
  }): Promise<TrustedContact> {
    return this.db.trustedContact.create({
      data: {
        userId: data.userId,
        name: data.name,
        phone: data.phone,
        relation: data.relation,
        isPrimary: data.isPrimary ?? false,
      },
    });
  }

  async updateContact(
    id: string,
    userId: string,
    data: {
      name?: string;
      phone?: string;
      relation?: string;
      isPrimary?: boolean;
      isVerified?: boolean;
    },
  ): Promise<TrustedContact> {
    return this.db.trustedContact.update({
      where: { id, userId }, // Ensure the user owns this contact
      data,
    });
  }

  async deleteContact(id: string, userId: string): Promise<void> {
    await this.db.trustedContact.delete({
      where: { id, userId },
    });
  }
}
