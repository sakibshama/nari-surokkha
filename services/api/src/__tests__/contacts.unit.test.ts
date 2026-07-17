/**
 * Contacts Module — Unit Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContactsService } from '@/modules/contacts/contacts.service';
import { ContactsRepository } from '@/modules/contacts/contacts.repository';
import { NotFoundError, ConflictError, ForbiddenError } from '@/utils/errors';
import { TrustedContact } from '@prisma/client';
import { Mocked } from 'vitest';

describe('ContactsService', () => {
  let service: ContactsService;
  let repo: Mocked<ContactsRepository>;

  const mockContact = {
    id: 'contact-1',
    userId: 'user-123',
    name: 'Test Contact',
    phone: '+8801912345678',
    relation: 'Father',
    isPrimary: true,
    isVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as TrustedContact;

  beforeEach(() => {
    repo = {
      getContactsByUserId: vi.fn(),
      getContactById: vi.fn(),
      countContactsByUserId: vi.fn(),
      createContact: vi.fn(),
      updateContact: vi.fn(),
      deleteContact: vi.fn(),
    } as unknown as Mocked<ContactsRepository>;

    service = new ContactsService(repo);
  });

  describe('createContact', () => {
    it('creates a contact successfully when under limit', async () => {
      repo.countContactsByUserId.mockResolvedValue(0);
      repo.getContactsByUserId.mockResolvedValue([]);
      repo.createContact.mockResolvedValue(mockContact);

      const result = await service.createContact('user-123', {
        name: 'Test Contact',
        phone: '+8801912345678',
      });

      expect(repo.createContact).toHaveBeenCalledWith({
        userId: 'user-123',
        name: 'Test Contact',
        phone: '+8801912345678',
        isPrimary: true, // Should be forced to primary if it's the first
      });
      expect(result).toEqual(mockContact);
    });

    it('throws ForbiddenError if user has 5 contacts', async () => {
      repo.countContactsByUserId.mockResolvedValue(5);

      await expect(
        service.createContact('user-123', {
          name: 'Test Contact',
          phone: '+8801912345678',
        })
      ).rejects.toThrow(ForbiddenError);
      expect(repo.createContact).not.toHaveBeenCalled();
    });

    it('throws ConflictError if phone number already exists', async () => {
      repo.countContactsByUserId.mockResolvedValue(1);
      repo.getContactsByUserId.mockResolvedValue([mockContact]);

      await expect(
        service.createContact('user-123', {
          name: 'Another Contact',
          phone: '+8801912345678',
        })
      ).rejects.toThrow(ConflictError);
      expect(repo.createContact).not.toHaveBeenCalled();
    });
  });

  describe('updateContact', () => {
    it('updates a contact successfully', async () => {
      repo.getContactById.mockResolvedValue(mockContact);
      repo.getContactsByUserId.mockResolvedValue([mockContact]);
      
      const updatedContact = { ...mockContact, name: 'Updated Name' };
      repo.updateContact.mockResolvedValue(updatedContact);

      const result = await service.updateContact('contact-1', 'user-123', {
        name: 'Updated Name',
      });

      expect(repo.updateContact).toHaveBeenCalledWith('contact-1', 'user-123', {
        name: 'Updated Name',
      });
      expect(result.name).toBe('Updated Name');
    });

    it('throws NotFoundError if contact does not exist', async () => {
      repo.getContactById.mockResolvedValue(null);

      await expect(
        service.updateContact('non-existent', 'user-123', { name: 'Name' })
      ).rejects.toThrow(NotFoundError);
      expect(repo.updateContact).not.toHaveBeenCalled();
    });

    it('throws ForbiddenError if unsetting the only primary contact', async () => {
      repo.getContactById.mockResolvedValue(mockContact); // contact is primary
      repo.countContactsByUserId.mockResolvedValue(2); // but there are other contacts

      await expect(
        service.updateContact('contact-1', 'user-123', { isPrimary: false })
      ).rejects.toThrow(ForbiddenError);
      expect(repo.updateContact).not.toHaveBeenCalled();
    });
  });

  describe('deleteContact', () => {
    it('deletes a contact successfully and promotes a new primary if needed', async () => {
      repo.getContactById.mockResolvedValue(mockContact); // contact is primary
      
      const contact2 = { ...mockContact, id: 'contact-2', isPrimary: false };
      repo.getContactsByUserId.mockResolvedValue([mockContact, contact2]);
      
      await service.deleteContact('contact-1', 'user-123');

      expect(repo.deleteContact).toHaveBeenCalledWith('contact-1', 'user-123');
      // Should have promoted contact-2 to primary
      expect(repo.updateContact).toHaveBeenCalledWith('contact-2', 'user-123', { isPrimary: true });
    });

    it('throws NotFoundError if contact to delete does not exist', async () => {
      repo.getContactById.mockResolvedValue(null);

      await expect(service.deleteContact('non-existent', 'user-123')).rejects.toThrow(NotFoundError);
      expect(repo.deleteContact).not.toHaveBeenCalled();
    });
  });
  describe('verifyContact', () => {
    it('verifies a contact successfully', async () => {
      repo.getContactById.mockResolvedValue(mockContact); // contact is not verified
      repo.updateContact.mockResolvedValue({ ...mockContact, isVerified: true });

      const result = await service.verifyContact('contact-1', 'user-123');

      expect(repo.updateContact).toHaveBeenCalledWith('contact-1', 'user-123', { isVerified: true });
      expect(result.isVerified).toBe(true);
    });

    it('returns contact without updating if already verified', async () => {
      repo.getContactById.mockResolvedValue({ ...mockContact, isVerified: true });

      const result = await service.verifyContact('contact-1', 'user-123');

      expect(repo.updateContact).not.toHaveBeenCalled();
      expect(result.isVerified).toBe(true);
    });

    it('throws NotFoundError if contact to verify does not exist', async () => {
      repo.getContactById.mockResolvedValue(null);

      await expect(service.verifyContact('non-existent', 'user-123')).rejects.toThrow(NotFoundError);
      expect(repo.updateContact).not.toHaveBeenCalled();
    });
  });
});
