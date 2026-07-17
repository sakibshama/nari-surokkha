/**
 * Auth Controller — Request Handlers
 *
 * Plumbs HTTP requests (Fastify) into the Auth Service.
 * Formats responses using standard helpers.
 * Never performs direct DB access.
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { AuthService } from './auth.service';
import { sendCreated, sendSuccess } from '@/utils/response';

export class AuthController {
  constructor(private readonly service: AuthService) {}

  register = async (
    req: FastifyRequest<{
      Body: Parameters<AuthService['register']>[0];
    }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const result = await this.service.register({
      ...req.body,
      ipAddress: req.ip,
      deviceInfo: req.headers['user-agent'],
    });

    reply.setCookie('refreshToken', result.tokens.refreshToken, {
      path: '/',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60, // 30 days
    });

    reply.setCookie('accessToken', result.tokens.accessToken, {
      path: '/',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 15 * 60, // 15 minutes
    });

    sendCreated(reply, result, 'Registration successful');
  };

  login = async (
    req: FastifyRequest<{
      Body: {
        phone: string;
        password: string;
        deviceToken?: string;
        platform?: 'android' | 'ios';
      };
    }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const result = await this.service.login({
      phone: req.body.phone,
      password: req.body.password,
      ipAddress: req.ip,
      deviceInfo: req.headers['user-agent'],
    });

    // If device token provided during login, register it
    if (req.body.deviceToken && req.body.platform) {
      await this.service.registerDeviceToken(
        result.user.id,
        req.body.deviceToken,
        req.body.platform,
      );
    }

    reply.setCookie('refreshToken', result.tokens.refreshToken, {
      path: '/',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60, // 30 days
    });

    reply.setCookie('accessToken', result.tokens.accessToken, {
      path: '/',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 15 * 60, // 15 minutes
    });

    sendSuccess(reply, result, 'Login successful');
  };

  refresh = async (
    req: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> => {
    // Try to get from body first (for legacy/mobile clients), then cookie
    const refreshToken = (req.body as any)?.refreshToken || req.cookies.refreshToken;
    if (!refreshToken) {
      reply.status(401).send({ message: 'No refresh token provided' });
      return;
    }

    const tokens = await this.service.refresh(refreshToken);

    reply.setCookie('refreshToken', tokens.refreshToken, {
      path: '/',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60, // 30 days
    });

    reply.setCookie('accessToken', tokens.accessToken, {
      path: '/',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 15 * 60, // 15 minutes
    });

    sendSuccess(reply, tokens, 'Token refreshed');
  };

  logout = async (
    req: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> => {
    const refreshToken = (req.body as any)?.refreshToken || req.cookies.refreshToken;
    if (refreshToken) {
      await this.service.logout(refreshToken);
    }
    
    reply.clearCookie('refreshToken', { path: '/' });
    reply.clearCookie('accessToken', { path: '/' });
    sendSuccess(reply, null, 'Logged out successfully');
  };

  logoutAll = async (
    req: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> => {
    // Requires authentication middleware (req.user is populated)
    const userId = req.user!.id;
    await this.service.logoutAll(userId);
    
    reply.clearCookie('refreshToken', { path: '/' });
    reply.clearCookie('accessToken', { path: '/' });
    sendSuccess(reply, null, 'Logged out from all devices');
  };

  changePassword = async (
    req: FastifyRequest<{
      Body: { currentPassword: string; newPassword: string };
    }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const userId = req.user!.id;
    await this.service.changePassword(
      userId,
      req.body.currentPassword,
      req.body.newPassword,
    );
    sendSuccess(reply, null, 'Password changed successfully. Please log in again.');
  };

  registerDeviceToken = async (
    req: FastifyRequest<{
      Body: { token: string; platform: 'android' | 'ios' };
    }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const userId = req.user!.id;
    await this.service.registerDeviceToken(
      userId,
      req.body.token,
      req.body.platform,
    );
    sendSuccess(reply, null, 'Device token registered');
  };
}
