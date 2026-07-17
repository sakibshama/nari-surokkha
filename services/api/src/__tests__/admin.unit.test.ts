import { describe, it, expect, beforeEach } from 'vitest';
import { AdminService } from '../modules/admin/admin.service';
import { AdminRepository } from '../modules/admin/admin.repository';
import { AuditLog } from '@prisma/client';

// Mock repository
const mockRepository = {} as unknown as AdminRepository;

describe('AdminService - Audit Log Masking', () => {
  let service: AdminService;

  beforeEach(() => {
    service = new AdminService(mockRepository);
  });

  it('should mask the last octet of an IPv4 address', () => {
    const log = {
      id: '1',
      action: 'login_attempt' as any,
      entityType: 'User',
      entityId: '123',
      ipAddress: '192.168.1.105',
      metadata: null,
      createdAt: new Date(),
    } as any as AuditLog;

    const masked = service.maskAuditLog(log);
    expect(masked.ipAddress).toBe('192.168.1.***');
  });

  it('should mask the end of an IPv6 address', () => {
    const log = {
      id: '1',
      action: 'login_attempt' as any,
      entityType: 'User',
      entityId: '123',
      ipAddress: '2001:0db8:85a3:0000:0000:8a2e:0370:7334',
      metadata: null,
      createdAt: new Date(),
    } as any as AuditLog;

    const masked = service.maskAuditLog(log);
    expect(masked.ipAddress).toBe('2001:0db8:85a3:0000:***:***');
  });

  it('should mask phone numbers embedded in metadata', () => {
    const log = {
      id: '1',
      action: 'phone_verification' as any,
      entityType: 'User',
      entityId: '123',
      ipAddress: '127.0.0.1',
      metadata: { phone: '+8801912345678', os: 'Android' },
      createdAt: new Date(),
    } as any as AuditLog;

    const masked = service.maskAuditLog(log);
    expect((masked.metadata as any).phone).toBe('+880***5678');
  });
});
