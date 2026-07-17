/**
 * Profile Controller
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { ProfileService } from './profile.service';
import { sendSuccess } from '@/utils/response';

export class ProfileController {
  constructor(private readonly service: ProfileService) {}

  getProfile = async (
    req: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> => {
    const userId = req.user!.id;
    const result = await this.service.getProfile(userId);

    // Filter out sensitive data (password hash etc)
    const { passwordHash: _hash, ...safeUser } = result;

    sendSuccess(reply, safeUser, 'Profile retrieved successfully');
  };

  updateProfile = async (
    req: FastifyRequest<{
      Body: Parameters<ProfileService['updateProfile']>[1];
    }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const userId = req.user!.id;
    const result = await this.service.updateProfile(userId, req.body);
    sendSuccess(reply, result, 'Profile updated successfully');
  };

  deactivateAccount = async (
    req: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> => {
    const userId = req.user!.id;
    await this.service.deactivateAccount(userId);
    // Ideally, we also log them out of all sessions here via AuthService
    // We'll add cross-module events or direct calls later if needed.
    sendSuccess(reply, null, 'Account deactivated successfully');
  };
}
