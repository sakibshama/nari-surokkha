/**
 * Environment configuration validation.
 *
 * Uses Zod to parse and validate ALL environment variables at startup.
 * If any required variable is missing or invalid, the app CRASHES immediately
 * with a clear error — this is intentional. Never let a misconfigured
 * service silently handle emergency alerts.
 */

import 'dotenv/config';
import { z } from 'zod';

const EnvSchema = z.object({
  // ─── Server ────────────────────────────────────────────────
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  HOST: z.string().default('0.0.0.0'),
  API_BASE_URL: z.string().url().default('http://localhost:3001'),

  // ─── Database ──────────────────────────────────────────────
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DATABASE_POOL_MIN: z.coerce.number().int().positive().default(2),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),

  // ─── Redis ─────────────────────────────────────────────────
  REDIS_URL: z.string().min(1, 'REDIS_URL is required').default('redis://localhost:6379'),
  REDIS_PASSWORD: z.string().optional(),

  // ─── Auth / JWT ────────────────────────────────────────────
  JWT_SECRET: z
    .string()
    .min(64, 'JWT_SECRET must be at least 64 characters for security'),
  JWT_REFRESH_SECRET: z
    .string()
    .min(64, 'JWT_REFRESH_SECRET must be at least 64 characters for security'),
  JWT_ACCESS_EXPIRY: z.string().default('15m'),
  JWT_REFRESH_EXPIRY: z.string().default('30d'),

  // ─── Password Hashing ──────────────────────────────────────
  ARGON2_MEMORY_COST: z.coerce.number().int().positive().default(65536),
  ARGON2_TIME_COST: z.coerce.number().int().positive().default(3),
  ARGON2_PARALLELISM: z.coerce.number().int().positive().default(4),

  // ─── CORS ──────────────────────────────────────────────────
  // Comma-separated allow-list. Defaults to local dev origins only.
  // A wildcard '*' is rejected in production (see superRefine below).
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:3000,http://localhost:3002')
    .transform((val) => (val === '*' ? '*' : val.split(',').map((o) => o.trim()))),

  // ─── Firebase ──────────────────────────────────────────────
  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_CLIENT_EMAIL: z.string().email().optional(),
  FIREBASE_PRIVATE_KEY: z.string().optional(),

  // ─── AWS S3 ────────────────────────────────────────────────
  AWS_S3_BUCKET: z.string().optional(),
  AWS_REGION: z.string().optional(),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),

  // ─── SMS ───────────────────────────────────────────────────
  // These act as the *fallback* provider config. The live config is
  // normally managed at runtime from the Admin Portal (SystemSetting
  // table). Values here are only used when no DB config is present.
  SMS_PROVIDER: z.enum(['mock', 'sslcommerz', 'bdbulksms', 'twilio']).default('mock'),
  SMS_API_KEY: z.string().optional(),
  SMS_API_SECRET: z.string().optional(),
  SMS_SENDER_ID: z.string().default('NariSurokkha'),
  // Twilio-specific fallbacks (optional; DB config takes precedence)
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM_NUMBER: z.string().optional(),

  // ─── Secret Encryption ─────────────────────────────────────
  // 32-byte key (hex = 64 chars, or base64) used to encrypt secret
  // settings (SMS API keys) at rest in the SystemSetting table.
  // REQUIRED in production if any SMS provider is configured via the
  // Admin Portal. Generate with: openssl rand -hex 32
  CONFIG_ENCRYPTION_KEY: z.string().optional(),

  // ─── Storage ───────────────────────────────────────────────
  STORAGE_PROVIDER: z.enum(['minio', 'aws-s3', 'cloudflare-r2']).default('minio'),
  // Local-disk storage (used when AWS_S3_BUCKET is not set). Absolute path
  // recommended in production, e.g. /var/lib/nari-surokkha/uploads. When empty,
  // defaults to "<api-working-dir>/uploads".
  STORAGE_LOCAL_DIR: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('ap-southeast-1'),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_BUCKET_EVIDENCE: z.string().default('nari-evidence'),
  S3_BUCKET_PUBLIC: z.string().default('nari-public'),

  // ─── ML Service ────────────────────────────────────────────
  ML_SERVICE_URL: z.string().url().default('http://localhost:8000'),
  ML_SERVICE_API_KEY: z.string().optional(),

  // ─── Rate Limiting ─────────────────────────────────────────
  RATE_LIMIT_LOGIN_MAX: z.coerce.number().int().positive().default(5),
  RATE_LIMIT_LOGIN_WINDOW_MS: z.coerce.number().int().positive().default(900_000),
  RATE_LIMIT_GLOBAL_MAX: z.coerce.number().int().positive().default(100),
  RATE_LIMIT_GLOBAL_WINDOW_MS: z.coerce.number().int().positive().default(60_000),

  // ─── Logging ───────────────────────────────────────────────
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  LOG_PRETTY: z
    .string()
    .default('false')
    .transform((val) => val === 'true'),

  // ─── Sentry ────────────────────────────────────────────────
  SENTRY_DSN: z.string().optional(),

  // ─── WebSocket ─────────────────────────────────────────────
  WS_CORS_ORIGINS: z
    .string()
    .default('http://localhost:3000,http://localhost:3002')
    .transform((val) => (val === '*' ? '*' : val.split(',').map((o) => o.trim()))),
}).superRefine((cfg, ctx) => {
  // Safety-critical: never allow wildcard CORS in production.
  if (cfg.NODE_ENV === 'production') {
    if (cfg.CORS_ORIGINS === '*') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CORS_ORIGINS'],
        message: 'CORS_ORIGINS must be an explicit allow-list in production (wildcard is forbidden).',
      });
    }
    if (cfg.WS_CORS_ORIGINS === '*') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['WS_CORS_ORIGINS'],
        message: 'WS_CORS_ORIGINS must be an explicit allow-list in production (wildcard is forbidden).',
      });
    }
  }
});

// Exported type for use throughout the app
export type Env = z.infer<typeof EnvSchema>;

/**
 * Validate and parse environment variables.
 * Call once at application startup.
 */
function validateEnv(): Env {
  const result = EnvSchema.safeParse(process.env);

  if (!result.success) {
    console.error('❌ Invalid environment configuration:');
    console.error(result.error.format());
    process.exit(1);
  }

  return result.data;
}

// Singleton — validated once on first import
export const env = validateEnv();
