/**
 * Profile Module — Unit Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProfileService } from '@/modules/profile/profile.service';
import { ProfileRepository } from '@/modules/profile/profile.repository';
import { NotFoundError } from '@/utils/errors';
import { User, UserProfile } from '@prisma/client';
import { Mocked } from 'vitest';

describe('ProfileService', () => {
  let service: ProfileService;
  let repo: Mocked<ProfileRepository>;

  const mockUserWithProfile = {
    id: 'user-123',
    phone: '+8801912345678',
    passwordHash: 'hashed-password',
    role: 'citizen',
    status: 'active',
    created_at: new Date(),
    updated_at: new Date(),
    email: null,
    profile: {
      id: 'profile-1',
      userId: 'user-123',
      fullName: 'Test User',
      bloodGroup: 'O+',
      preferredLanguage: 'bn',
      emergencyNote: null,
      nationalId: null,
      profilePhotoKey: null,
      isVerified: false,
      verifiedAt: null,
      created_at: new Date(),
      updated_at: new Date(),
    } as unknown as UserProfile,
  } as unknown as User & { profile: UserProfile | null };

  beforeEach(() => {
    repo = {
      getProfileByUserId: vi.fn(),
      updateProfile: vi.fn(),
      markAsVerified: vi.fn(),
      deactivateAccount: vi.fn(),
    } as unknown as Mocked<ProfileRepository>;

    service = new ProfileService(repo);
  });

  describe('getProfile', () => {
    it('returns the user profile when found', async () => {
      repo.getProfileByUserId.mockResolvedValue(mockUserWithProfile);

      const result = await service.getProfile('user-123');

      expect(repo.getProfileByUserId).toHaveBeenCalledWith('user-123');
      expect(result).toEqual(mockUserWithProfile);
    });

    it('throws NotFoundError when user does not exist', async () => {
      repo.getProfileByUserId.mockResolvedValue(null);

      await expect(service.getProfile('non-existent')).rejects.toThrow(NotFoundError);
    });
  });

  describe('updateProfile', () => {
    it('updates the profile when user exists', async () => {
      repo.getProfileByUserId.mockResolvedValue(mockUserWithProfile);
      
      const updateData = { fullName: 'Updated Name', bloodGroup: 'AB+' };
      const updatedProfile = { ...mockUserWithProfile.profile, ...updateData };
      repo.updateProfile.mockResolvedValue(updatedProfile as any);

      const result = await service.updateProfile('user-123', updateData);

      expect(repo.updateProfile).toHaveBeenCalledWith('user-123', updateData);
      expect(result.fullName).toBe('Updated Name');
      expect(result.bloodGroup).toBe('AB+');
    });

    it('throws NotFoundError when trying to update non-existent user', async () => {
      repo.getProfileByUserId.mockResolvedValue(null);

      await expect(
        service.updateProfile('non-existent', { fullName: 'Name' })
      ).rejects.toThrow(NotFoundError);
      
      expect(repo.updateProfile).not.toHaveBeenCalled();
    });
  });

  describe('deactivateAccount', () => {
    it('deactivates account for existing user', async () => {
      repo.getProfileByUserId.mockResolvedValue(mockUserWithProfile);
      repo.deactivateAccount.mockResolvedValue({ ...mockUserWithProfile, status: 'inactive' });

      await service.deactivateAccount('user-123');

      expect(repo.deactivateAccount).toHaveBeenCalledWith('user-123');
    });

    it('throws NotFoundError when trying to deactivate non-existent user', async () => {
      repo.getProfileByUserId.mockResolvedValue(null);

      await expect(service.deactivateAccount('non-existent')).rejects.toThrow(NotFoundError);
      expect(repo.deactivateAccount).not.toHaveBeenCalled();
    });
  });
});
