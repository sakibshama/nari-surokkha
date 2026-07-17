/**
 * Police Service
 */

import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import { FastifyInstance } from 'fastify';
import { PoliceRepository } from './police.repository';
import { UnauthorizedError, ForbiddenError } from '@/utils/errors';
import { env } from '@/config/env';

export class PoliceService {
  constructor(
    private readonly repo: PoliceRepository,
    private readonly fastify: FastifyInstance
  ) {}

  async login(identifier: string, password: string) {
    const policeUser = await this.repo.findPoliceUserByIdentifier(identifier);

    const dummyHash = '$argon2id$v=19$m=65536,t=3,p=4$dummysalt00000000$dummyhash000000000000000000000000000';
    const passwordValid = await argon2.verify(
      policeUser?.passwordHash ?? dummyHash,
      password,
    );

    if (!policeUser || !passwordValid) {
      throw new UnauthorizedError('Invalid credentials.');
    }

    if (!policeUser.isActive) {
      throw new ForbiddenError('Your police account is inactive.');
    }

    // Generate token
    const payload = {
      sub: policeUser.id,
      role: 'police',
      stationId: policeUser.stationId,
      badgeNumber: policeUser.badgeNumber,
      type: 'access',
    };

    const accessToken = jwt.sign(payload, env.JWT_SECRET, { expiresIn: '8h' });

    return {
      user: {
        id: policeUser.id,
        fullName: policeUser.fullName,
        badgeNumber: policeUser.badgeNumber,
        role: policeUser.role,
        stationId: policeUser.stationId,
        stationName: (policeUser as any).station?.name || 'Unknown Station',
      },
      tokens: {
        accessToken,
        refreshToken: 'no-refresh-for-police-mvp',
        expiresIn: 28800,
      },
    };
  }

  async getStations() {
    return this.repo.getStations();
  }

  async getResponders() {
    return this.repo.getResponders();
  }

  async getActiveAlerts(stationId: string) {
    return this.repo.getActiveAlertsForStation(stationId);
  }

  async getAlertById(alertId: string, stationId: string) {
    const alert = await this.repo.getAlertById(alertId, stationId);
    if (!alert) {
      throw new UnauthorizedError('Alert not found or access denied.');
    }
    return alert;
  }

  async updateAlertStatus(alertId: string, status: string, stationId: string, officerId: string) {
    const alert = await this.repo.updateAlertStatus(alertId, status);
    
    // Auto-create case if status becomes in_progress
    if (status === 'in_progress') {
      await this.repo.createCase(alertId, stationId, officerId);
    }
    
    // Broadcast status update
    if (this.fastify.io) {
      this.fastify.io.to(`station:${stationId}`).emit('alert_status_update', {
        alertId,
        status,
        updatedBy: officerId,
      });
    }

    return alert;
  }

  async getProfile(userId: string) {
    const user = await this.repo.findPoliceUserById(userId);
    if (!user) throw new UnauthorizedError('User not found.');
    return {
      id: user.id,
      badgeNumber: user.badgeNumber,
      fullName: user.fullName,
      phone: user.phone,
      email: user.email,
      role: user.role,
    };
  }

  async updateProfile(userId: string, data: { phone?: string; email?: string }) {
    const user = await this.repo.updatePoliceProfile(userId, data);
    return {
      id: user.id,
      badgeNumber: user.badgeNumber,
      fullName: user.fullName,
      phone: user.phone,
      email: user.email,
      role: user.role,
    };
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.repo.findPoliceUserById(userId);
    if (!user) throw new UnauthorizedError('User not found.');

    const passwordValid = await argon2.verify(user.passwordHash, currentPassword);
    if (!passwordValid) throw new UnauthorizedError('Incorrect current password.');

    const passwordHash = await argon2.hash(newPassword, {
      type: argon2.argon2id,
      memoryCost: env.ARGON2_MEMORY_COST,
      timeCost: env.ARGON2_TIME_COST,
      parallelism: env.ARGON2_PARALLELISM,
    });

    await this.repo.updatePolicePassword(userId, passwordHash);
  }
}
