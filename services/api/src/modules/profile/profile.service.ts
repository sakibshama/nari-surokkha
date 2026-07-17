/**
 * Profile Service — Business Logic Layer
 */

import { ProfileRepository, UserWithProfile } from './profile.repository';
import { NotFoundError } from '@/utils/errors';
import { UserProfile } from '@prisma/client';

export class ProfileService {
  constructor(private readonly repo: ProfileRepository) {}

  async getProfile(userId: string): Promise<UserWithProfile> {
    const user = await this.repo.getProfileByUserId(userId);
    if (!user) {
      throw new NotFoundError('User profile not found.');
    }
    return user;
  }

  async updateProfile(
    userId: string,
    data: {
      fullName?: string;
      bloodGroup?: string;
      preferredLanguage?: string;
      emergencyNote?: string;
      nationalId?: string;
      profilePhotoKey?: string;
    },
  ): Promise<UserProfile> {
    // Check if user exists first to throw 404 if not found
    await this.getProfile(userId);

    // If a national ID is provided, user should be re-verified manually
    // For now we just update the profile
    return this.repo.updateProfile(userId, data);
  }

  async deactivateAccount(userId: string): Promise<void> {
    await this.getProfile(userId);
    await this.repo.deactivateAccount(userId);
  }
}
