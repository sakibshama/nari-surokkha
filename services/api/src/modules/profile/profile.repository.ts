/**
 * Profile Repository — Database Access Layer
 */

import { PrismaClient, UserProfile, User } from '@prisma/client';

export type UserWithProfile = User & { profile: UserProfile | null };

export class ProfileRepository {
  constructor(private readonly db: PrismaClient) {}

  async getProfileByUserId(userId: string): Promise<UserWithProfile | null> {
    return this.db.user.findUnique({
      where: { id: userId },
      include: { profile: true },
    });
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
    return this.db.userProfile.update({
      where: { userId },
      data,
    });
  }

  async isEmailTakenByOther(email: string, userId: string): Promise<boolean> {
    const owner = await this.db.user.findUnique({ where: { email }, select: { id: true } });
    return !!owner && owner.id !== userId;
  }

  async updateEmail(userId: string, email: string | null): Promise<void> {
    await this.db.user.update({ where: { id: userId }, data: { email } });
  }

  async markAsVerified(userId: string): Promise<UserProfile> {
    return this.db.userProfile.update({
      where: { userId },
      data: {
        isVerified: true,
        verifiedAt: new Date(),
      },
    });
  }

  // Soft delete / account deactivation
  async deactivateAccount(userId: string): Promise<User> {
    return this.db.user.update({
      where: { id: userId },
      data: { status: 'inactive' },
    });
  }
}
