// ============================================================
// Nari Surokkha — Shared Types
// All TypeScript interfaces and enums shared across services
// ============================================================

// ─── User & Auth ────────────────────────────────────────────

export interface Role {
  id: string;
  name: string;
  key: string;
  description?: string;
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
}

export enum UserStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  SUSPENDED = 'suspended',
  PENDING_VERIFICATION = 'pending_verification',
}

export interface User {
  id: string;
  phone: string;
  email?: string;
  roleId: string;
  role?: Role;
  status: UserStatus;
  createdAt: string;
  updatedAt: string;
}

export interface UserProfile {
  id: string;
  userId: string;
  fullName: string;
  bloodGroup?: string;
  preferredLanguage: 'bn' | 'en';
  emergencyNote?: string;
  isVerified: boolean;
  createdAt: string;
  updatedAt: string;
}

// ─── Trusted Contacts ────────────────────────────────────────

export interface TrustedContact {
  id: string;
  userId: string;
  name: string;
  phone: string;
  relation?: string;
  isPrimary: boolean;
  isVerified: boolean;
  createdAt: string;
  updatedAt: string;
}

// ─── Alerts & SOS ────────────────────────────────────────────

export enum AlertStatus {
  CREATED = 'created',
  CONFIRMED = 'confirmed',
  NOTIFIED_CONTACTS = 'notified_contacts',
  SENT_TO_POLICE = 'sent_to_police',
  ACKNOWLEDGED_BY_POLICE = 'acknowledged_by_police',
  IN_PROGRESS = 'in_progress',
  RESOLVED = 'resolved',
  CANCELLED = 'cancelled',
  FALSE_ALARM = 'false_alarm',
  CLOSED = 'closed',
}

export enum AlertType {
  MANUAL = 'manual',
  SENSOR_TRIGGERED = 'sensor_triggered',
  ML_TRIGGERED = 'ml_triggered',
}

export interface EmergencyAlert {
  id: string;
  userId: string;
  type: AlertType;
  status: AlertStatus;
  latitude: number;
  longitude: number;
  accuracy?: number;
  createdAt: string;
  updatedAt: string;
}

export interface AlertLocation {
  id: string;
  alertId: string;
  latitude: number;
  longitude: number;
  accuracy?: number;
  timestamp: string;
}

// ─── Evidence ─────────────────────────────────────────────────

export enum EvidenceType {
  PHOTO = 'photo',
  AUDIO = 'audio',
  VIDEO = 'video',
  DOCUMENT = 'document',
}

export interface AlertEvidence {
  id: string;
  alertId: string;
  type: EvidenceType;
  fileKey: string;
  checksum: string;
  sizeBytes: number;
  uploadedAt: string;
}

// ─── Responders ───────────────────────────────────────────────

export enum ResponderStatus {
  PENDING = 'pending',
  VERIFIED = 'verified',
  REJECTED = 'rejected',
  SUSPENDED = 'suspended',
}

export enum ResponderAvailability {
  AVAILABLE = 'available',
  BUSY = 'busy',
  OFFLINE = 'offline',
}

export interface Responder {
  id: string;
  userId: string;
  status: ResponderStatus;
  availability: ResponderAvailability;
  latitude?: number;
  longitude?: number;
  lastLocationAt?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Police ───────────────────────────────────────────────────

export interface PoliceStation {
  id: string;
  name: string;
  thanaCode: string;
  district: string;
  division: string;
  latitude: number;
  longitude: number;
  phone: string;
  isActive: boolean;
}

export enum PoliceUserRole {
  OFFICER = 'officer',
  SUPERVISOR = 'supervisor',
  ADMIN = 'admin',
}

export interface PoliceUser {
  id: string;
  stationId: string;
  badgeNumber: string;
  fullName: string;
  role: PoliceUserRole;
  isActive: boolean;
}

// ─── Cases ────────────────────────────────────────────────────

export enum CaseStatus {
  OPEN = 'open',
  ASSIGNED = 'assigned',
  IN_PROGRESS = 'in_progress',
  RESOLVED = 'resolved',
  CLOSED = 'closed',
  FALSE_ALARM = 'false_alarm',
}

export interface Case {
  id: string;
  alertId: string;
  stationId: string;
  assignedOfficerId?: string;
  status: CaseStatus;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Notifications ────────────────────────────────────────────

export enum NotificationType {
  SOS_ALERT = 'sos_alert',
  LOCATION_UPDATE = 'location_update',
  CASE_UPDATE = 'case_update',
  RESPONDER_ACCEPTED = 'responder_accepted',
  SYSTEM = 'system',
}

export interface NotificationPayload {
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, string>;
}

// ─── WebSocket Events ─────────────────────────────────────────

export enum WsEvent {
  // Server → Client
  NEW_ALERT = 'new_alert',
  LOCATION_UPDATE = 'location_update',
  ALERT_STATUS_UPDATE = 'alert_status_update',
  EVIDENCE_UPLOADED = 'evidence_uploaded',
  RESPONDER_NEARBY = 'responder_nearby',

  // Client → Server
  JOIN_STATION_ROOM = 'join_station_room',
  LEAVE_STATION_ROOM = 'leave_station_room',
  ACKNOWLEDGE_ALERT = 'acknowledge_alert',
}

// ─── API Response Shapes ──────────────────────────────────────

export interface ApiSuccess<T> {
  success: true;
  data: T;
  message?: string;
}

export interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

// ─── Pagination ───────────────────────────────────────────────

export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  meta: PaginationMeta;
}

// ─── Safety Score ─────────────────────────────────────────────

export interface SafetyScore {
  areaId: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  score: number; // 0-100, 100 = very safe
  incidentCount: number;
  calculatedAt: string;
}

// ─── Incident Reports ─────────────────────────────────────────

export enum IncidentType {
  HARASSMENT = 'harassment',
  ASSAULT = 'assault',
  STALKING = 'stalking',
  UNSAFE_AREA = 'unsafe_area',
  OTHER = 'other',
}

export interface IncidentReport {
  id: string;
  type: IncidentType;
  latitude: number;
  longitude: number;
  description?: string;
  isAnonymous: boolean;
  createdAt: string;
}

// ─── ML Events ───────────────────────────────────────────────

export enum MlDetectionType {
  FALL = 'fall',
  STRUGGLE_MOTION = 'struggle_motion',
  DISTRESS_AUDIO = 'distress_audio',
  TRIGGER_WORD = 'trigger_word',
}

export interface MlDetectionEvent {
  id: string;
  userId: string;
  type: MlDetectionType;
  confidence: number;
  rawMetadata?: Record<string, unknown>;
  triggeredSoftAlert: boolean;
  softAlertCancelled: boolean;
  createdAt: string;
}
