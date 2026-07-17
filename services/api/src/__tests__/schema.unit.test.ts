/**
 * Schema Unit Tests — Phase 3
 *
 * Validates the Prisma schema structure without a real database.
 * Tests: all models exist, enum values match shared types.
 */

import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';
// Prisma v5 exports enums directly (not under Prisma namespace)
import {
  AlertStatus as PrismaAlertStatus,
  AlertType as PrismaAlertType,
  CaseStatus as PrismaCaseStatus,
  EvidenceType as PrismaEvidenceType,
  ResponderStatus as PrismaResponderStatus,
  AuditAction as PrismaAuditAction,
  MlDetectionType as PrismaMlDetectionType,
  NotificationChannel as PrismaNotificationChannel,
} from '@prisma/client';
import { AlertStatus, AlertType, CaseStatus } from '@nari-surokkha/shared';

describe('Prisma Schema — Model Existence', () => {
  it('should have all 22 required models defined', () => {
    const requiredModels = [
      'User', 'UserProfile', 'UserSession', 'DeviceToken',
      'TrustedContact', 'PoliceStation', 'PoliceUser',
      'EmergencyAlert', 'AlertLocation', 'AlertEvidence',
      'EvidenceAccessLog', 'AlertRecipient',
      'Responder', 'ResponderVerification', 'ResponderDispatch',
      'Case', 'CaseUpdate', 'NotificationLog',
      'MlDetectionEvent', 'IncidentReport', 'SafetyScore', 'AuditLog',
    ];

    const modelNames = Object.values(Prisma.ModelName);
    for (const model of requiredModels) {
      expect(modelNames, `Missing Prisma model: ${model}`).toContain(model);
    }
  });
});

describe('Enum Alignment — Shared Types vs Prisma', () => {
  it('AlertStatus matches between shared types and Prisma', () => {
    const prismaValues = Object.values(PrismaAlertStatus).sort();
    const sharedValues = Object.values(AlertStatus).sort();
    expect(prismaValues).toEqual(sharedValues);
  });

  it('AlertType matches between shared types and Prisma', () => {
    const prismaValues = Object.values(PrismaAlertType).sort();
    const sharedValues = Object.values(AlertType).sort();
    expect(prismaValues).toEqual(sharedValues);
  });


  it('CaseStatus matches between shared types and Prisma', () => {
    const prismaValues = Object.values(PrismaCaseStatus).sort();
    const sharedValues = Object.values(CaseStatus).sort();
    expect(prismaValues).toEqual(sharedValues);
  });
});

describe('Schema Integrity — README Spec', () => {
  it('EvidenceType has all 4 required values', () => {
    expect(Object.values(PrismaEvidenceType)).toContain('photo');
    expect(Object.values(PrismaEvidenceType)).toContain('audio');
    expect(Object.values(PrismaEvidenceType)).toContain('video');
    expect(Object.values(PrismaEvidenceType)).toContain('document');
  });

  it('ResponderStatus has all 4 values', () => {
    const statuses = Object.values(PrismaResponderStatus);
    expect(statuses).toContain('pending');
    expect(statuses).toContain('verified');
    expect(statuses).toContain('rejected');
    expect(statuses).toContain('suspended');
  });

  it('AuditAction covers all sensitive operations', () => {
    const actions = Object.values(PrismaAuditAction);
    expect(actions).toContain('sos_triggered');
    expect(actions).toContain('evidence_accessed');
    expect(actions).toContain('alert_acknowledged');
    expect(actions).toContain('case_closed');
    expect(actions).toContain('login');
    expect(actions).toContain('logout');
  });

  it('MlDetectionType covers all 4 detection types from README', () => {
    const types = Object.values(PrismaMlDetectionType);
    expect(types).toContain('fall');
    expect(types).toContain('struggle_motion');
    expect(types).toContain('distress_audio');
    expect(types).toContain('trigger_word');
  });

  it('NotificationChannel has SMS and push', () => {
    const channels = Object.values(PrismaNotificationChannel);
    expect(channels).toContain('sms');
    expect(channels).toContain('push');
  });
});
