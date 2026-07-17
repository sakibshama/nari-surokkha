// ============================================================
// Nari Surokkha — Shared Zod Validation Schemas
// Used on both backend (API) and mobile/portal for form validation
// ============================================================

import { z } from 'zod';

// ─── Common ──────────────────────────────────────────────────

export const PhoneSchema = z
  .string()
  .regex(/^\+8801[3-9]\d{8}$/, 'Must be a valid Bangladeshi phone number (+8801XXXXXXXXX)');

export const PaginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const CoordinatesSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().positive().optional(),
});

// ─── Auth ────────────────────────────────────────────────────

export const RegisterSchema = z.object({
  phone: PhoneSchema,
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128)
    .regex(/[A-Z]/, 'Must contain at least one uppercase letter')
    .regex(/[0-9]/, 'Must contain at least one number'),
  fullName: z.string().min(2).max(100),
  preferredLanguage: z.enum(['bn', 'en']).default('bn'),
});

export const LoginSchema = z.object({
  phone: PhoneSchema,
  password: z.string().min(1),
  deviceToken: z.string().optional(),
});

export const RefreshTokenSchema = z.object({
  refreshToken: z.string().min(1),
});

export const DeviceTokenSchema = z.object({
  token: z.string().min(1),
  platform: z.enum(['android', 'ios']),
});

// ─── User Profile ─────────────────────────────────────────────

export const UpdateProfileSchema = z.object({
  fullName: z.string().min(2).max(100).optional(),
  bloodGroup: z.enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']).optional(),
  preferredLanguage: z.enum(['bn', 'en']).optional(),
  emergencyNote: z.string().max(500).optional(),
});

// ─── Trusted Contacts ─────────────────────────────────────────

export const CreateTrustedContactSchema = z.object({
  name: z.string().min(2).max(100),
  phone: PhoneSchema,
  relation: z.string().max(50).optional(),
  isPrimary: z.boolean().default(false),
});

export const UpdateTrustedContactSchema = CreateTrustedContactSchema.partial();

// ─── SOS Alert ───────────────────────────────────────────────

export const CreateSosAlertSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().positive().optional(),
  type: z.enum(['manual', 'sensor_triggered', 'ml_triggered']).default('manual'),
  mlMetadata: z
    .object({
      detectionType: z.string(),
      confidence: z.number().min(0).max(1),
    })
    .optional(),
});

export const UpdateLocationSchema = z.object({
  alertId: z.string().uuid(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().positive().optional(),
  timestamp: z.string().datetime().optional(),
});

// ─── Evidence ─────────────────────────────────────────────────

export const UploadEvidenceSchema = z.object({
  alertId: z.string().uuid(),
  type: z.enum(['photo', 'audio', 'video', 'document']),
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(1),
});

// ─── Responder ────────────────────────────────────────────────

export const ApplyResponderSchema = z.object({
  nationalId: z.string().min(10).max(20),
  occupation: z.string().max(100).optional(),
  organizationName: z.string().max(100).optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

export const UpdateResponderLocationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

// ─── Incident Report ──────────────────────────────────────────

export const CreateIncidentReportSchema = z.object({
  type: z.enum(['harassment', 'assault', 'stalking', 'unsafe_area', 'other']),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  description: z.string().max(1000).optional(),
  isAnonymous: z.boolean().default(true),
});

// ─── Case Management ──────────────────────────────────────────

export const UpdateCaseSchema = z.object({
  status: z
    .enum(['open', 'assigned', 'in_progress', 'resolved', 'closed', 'false_alarm'])
    .optional(),
  assignedOfficerId: z.string().uuid().optional(),
  notes: z.string().max(2000).optional(),
});

export const AddCaseNoteSchema = z.object({
  note: z.string().min(1).max(2000),
});
