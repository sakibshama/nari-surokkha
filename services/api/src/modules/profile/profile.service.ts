/**
 * Profile Service — Business Logic Layer
 */

import { ProfileRepository, UserWithProfile } from './profile.repository';
import { ConflictError, NotFoundError } from '@/utils/errors';
import { Prisma, UserProfile } from '@prisma/client';

export type ProfileUpdate = {
  email?: string | null;
  fullName?: string;
  bloodGroup?: string;
  preferredLanguage?: string;
  emergencyNote?: string;
  nationalId?: string;
  profilePhotoKey?: string;
};

export class ProfileService {
  constructor(private readonly repo: ProfileRepository) {}

  async getProfile(userId: string): Promise<UserWithProfile> {
    const user = await this.repo.getProfileByUserId(userId);
    if (!user) {
      throw new NotFoundError('User profile not found.');
    }
    return user;
  }

  /** Profile fields plus the account email (unique; '' clears it). */
  async updateProfile(userId: string, data: ProfileUpdate): Promise<UserProfile & { email: string | null }> {
    const { email: rawEmail, ...profileData } = data;
    const user = await this.getProfile(userId);

    let email = user.email;
    if (rawEmail !== undefined) {
      email = rawEmail?.trim().toLowerCase() || null;
      if (email !== user.email) {
        if (email && (await this.repo.isEmailTakenByOther(email, userId))) {
          throw new ConflictError('This email is already in use by another account.');
        }
        try {
          await this.repo.updateEmail(userId, email);
        } catch (err) {
          // Lost a race with another account claiming the same address.
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
            throw new ConflictError('This email is already in use by another account.');
          }
          throw err;
        }
      }
    }

    const profile = await this.repo.updateProfile(userId, profileData);
    return { ...profile, email };
  }

  async deactivateAccount(userId: string): Promise<void> {
    await this.getProfile(userId);
    await this.repo.deactivateAccount(userId);
  }
}
