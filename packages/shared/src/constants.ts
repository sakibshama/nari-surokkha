// ============================================================
// Nari Surokkha — Shared Constants
// App-wide constants shared across all services and apps
// ============================================================

// ─── API ─────────────────────────────────────────────────────

export const API_VERSION = 'v1';
export const API_PREFIX = `/api/${API_VERSION}`;

// ─── Auth ────────────────────────────────────────────────────

export const ACCESS_TOKEN_EXPIRY = '15m';
export const REFRESH_TOKEN_EXPIRY = '30d';
export const MAX_LOGIN_ATTEMPTS = 1000;
export const LOGIN_LOCKOUT_MINUTES = 15;

// ─── Alerts ───────────────────────────────────────────────────

export const SOFT_ALERT_COUNTDOWN_SECONDS = 15;
export const MAX_ACTIVE_ALERTS_PER_USER = 1;
export const NEARBY_RESPONDER_RADIUS_METERS = 2000;
export const NEAREST_POLICE_STATION_RADIUS_METERS = 50000; // 50 km

// ─── Evidence ─────────────────────────────────────────────────

export const MAX_EVIDENCE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB
export const EVIDENCE_SIGNED_URL_EXPIRY_SECONDS = 300; // 5 minutes
export const ALLOWED_EVIDENCE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'audio/mpeg',
  'audio/wav',
  'audio/ogg',
  'audio/mp4',
  'video/mp4',
  'video/quicktime',
  'application/pdf',
] as const;

// ─── Notifications ────────────────────────────────────────────

export const MAX_SMS_RETRY = 3;
export const MAX_PUSH_RETRY = 3;
export const NOTIFICATION_QUEUE_NAME = 'notifications';
export const LOCATION_UPDATE_QUEUE_NAME = 'location-updates';

// ─── Trusted Contacts ─────────────────────────────────────────

export const MAX_TRUSTED_CONTACTS = 5;
export const MIN_TRUSTED_CONTACTS_FOR_SOS = 1;

// ─── Pagination ───────────────────────────────────────────────

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

// ─── WebSocket ────────────────────────────────────────────────

export const WS_NAMESPACE_POLICE = '/police';
export const WS_NAMESPACE_RESPONDER = '/responder';

// ─── Safety Score ─────────────────────────────────────────────

export const SAFETY_SCORE_MAX = 100;
export const SAFETY_SCORE_RADIUS_METERS = 500;
export const SAFETY_SCORE_DECAY_DAYS = 90; // older incidents weigh less

// ─── ML ───────────────────────────────────────────────────────

export const ML_CONFIDENCE_THRESHOLD = 0.75; // 75% confidence to trigger soft alert
export const ML_SENSOR_WINDOW_MS = 2000; // 2 second sliding window
export const ML_AUDIO_SAMPLE_RATE = 16000; // 16kHz for speech detection

// ─── Error Codes ──────────────────────────────────────────────

export const ERROR_CODES = {
  // Auth
  UNAUTHORIZED: 'AUTH_001',
  FORBIDDEN: 'AUTH_002',
  TOKEN_EXPIRED: 'AUTH_003',
  INVALID_CREDENTIALS: 'AUTH_004',
  ACCOUNT_LOCKED: 'AUTH_005',

  // Validation
  VALIDATION_ERROR: 'VAL_001',
  INVALID_PHONE: 'VAL_002',

  // User
  USER_NOT_FOUND: 'USER_001',
  USER_ALREADY_EXISTS: 'USER_002',
  PROFILE_NOT_FOUND: 'USER_003',

  // Contacts
  CONTACT_NOT_FOUND: 'CONTACT_001',
  MAX_CONTACTS_REACHED: 'CONTACT_002',
  NO_TRUSTED_CONTACTS: 'CONTACT_003',

  // Alerts
  ALERT_NOT_FOUND: 'ALERT_001',
  ALERT_ALREADY_ACTIVE: 'ALERT_002',
  ALERT_CLOSED: 'ALERT_003',
  NO_POLICE_STATION_NEARBY: 'ALERT_004',

  // Evidence
  EVIDENCE_NOT_FOUND: 'EVIDENCE_001',
  FILE_TOO_LARGE: 'EVIDENCE_002',
  INVALID_MIME_TYPE: 'EVIDENCE_003',

  // Responder
  RESPONDER_NOT_VERIFIED: 'RESPONDER_001',
  RESPONDER_NOT_FOUND: 'RESPONDER_002',

  // General
  INTERNAL_ERROR: 'SERVER_001',
  NOT_FOUND: 'SERVER_002',
  TOO_MANY_REQUESTS: 'SERVER_003',
} as const;

// ─── HTTP Status ──────────────────────────────────────────────

export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_ERROR: 500,
} as const;
