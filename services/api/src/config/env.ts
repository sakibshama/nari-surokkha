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
  // Migrations bypass PgBouncer — DDL and advisory locks cannot go through a
  // transaction pooler. Optional: falls back to DATABASE_URL when unset.
  DIRECT_DATABASE_URL: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  // Optional read replica. When set, analytics and audit-log reads are routed
  // here so a heavy dashboard query cannot compete with an SOS write on the
  // primary. Unset = everything uses the primary (current behaviour).
  REPLICA_DATABASE_URL: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  DATABASE_POOL_MIN: z.coerce.number().int().positive().default(2),
  // Prisma takes its pool size from ?connection_limit= on the connection
  // string, so this value was previously validated and then ignored. It is now
  // applied in plugins/database.ts when the URL does not already specify one.
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
  // preprocess: treat empty strings (e.g. `FIREBASE_CLIENT_EMAIL=` in an env
  // file) as "not set" so optional fields don't fail format validation.
  FIREBASE_PROJECT_ID: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  FIREBASE_CLIENT_EMAIL: z.preprocess((v) => (v === '' ? undefined : v), z.string().email().optional()),
  FIREBASE_PRIVATE_KEY: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),

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
  // 'local' keeps evidence on the container's disk (development, or a
  // deliberate single-host deployment). Anything else routes to object
  // storage, which is what allows more than one API host.
  STORAGE_PROVIDER: z.enum(['local', 'minio', 'aws-s3', 'cloudflare-r2']).default('minio'),
  // Server-side encryption for evidence at rest. Unset = SSE-S3 (AES256);
  // set to a KMS key id for a customer-managed key with its own audit trail.
  S3_KMS_KEY_ID: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  // How long evidence is retained after its alert is closed. Evidence for an
  // OPEN case is never purged regardless of age.
  EVIDENCE_RETENTION_DAYS: z.coerce.number().int().positive().default(365),
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
  //
  // NOTE (2026-08-19): ML_SERVICE_URL and ML_SERVICE_API_KEY are declared here
  // but referenced NOWHERE else in the API. Detection runs on-device (TFLite
  // in the mobile app); the `ml` module is only a model registry and training
  // sample collector, and never calls the FastAPI service.
  //
  // So the ml-service container in docker-compose currently serves no traffic
  // from us. Before adding key rotation here, decide which is true:
  //   (a) it is genuinely unused  -> drop the service and these two vars, or
  //   (b) it is meant to be used  -> wire the calls, THEN add rotation.
  // Adding rotation for a call that does not exist would just be more dead
  // config of exactly the kind this file already accumulated.

  // ─── Live tracking ─────────────────────────────────────────
  // Public base URL for the SOS tracking link sent in SMS (e.g.
  // https://api.mystrix-soft.com). Falls back to API_BASE_URL. Must be a host
  // reachable from a recipient's phone browser.
  PUBLIC_TRACKING_URL: z.string().url().optional(),

  // ─── WebRTC ICE (STUN/TURN) ────────────────────────────────
  // Served to clients via GET /config/ice-servers so the TURN credential lives
  // in ONE place (here) and never drifts out of sync with the coturn container.
  // TURN is required for streaming across different networks (cellular ↔ wifi).
  STUN_URL: z.string().default('stun:stun.l.google.com:19302'),
  TURN_HOST: z.string().optional(),      // e.g. api.mystrix-soft.com
  TURN_PORT: z.coerce.number().int().positive().default(3478),
  TURN_USERNAME: z.string().default('nari'),
  TURN_PASSWORD: z.string().optional(),  // same value passed to the coturn container

  // ─── Safe Route routing engine ─────────────────────────────
  // OSRM (Open Source Routing Machine). Default is the public demo server —
  // fine for a pilot; self-host for production (docker: osrm/osrm-backend).
  // Profile in the path (…/route/v1/walking/…) is chosen in code.
  OSRM_URL: z.string().url().default('https://router.project-osrm.org'),

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
  SENTRY_DSN: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),
  // Fraction of requests traced. 0.1 is a sane production default; tracing
  // every request on a safety-critical path costs latency for little insight.
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),

  // ─── Process role ──────────────────────────────────────────
  // The API and the background workers run the same image. WORKER_MODE decides
  // which half of it is active:
  //   false -> HTTP only  (services/api entrypoint: dist/server.js)
  //   true  -> jobs only  (worker  entrypoint: dist/worker.js)
  // Defaults to true outside production so `npm run dev` remains a single
  // process that both serves and processes jobs.
  WORKER_MODE: z.preprocess(
    (v) => (v === undefined || v === '' ? undefined : v === 'true' || v === true),
    z.boolean().optional(),
  ),

  // ─── Metrics ───────────────────────────────────────────────
  // Prometheus scrapes /metrics on a SEPARATE port so it is never reachable
  // through the public nginx server block.
  METRICS_ENABLED: z
    .preprocess((v) => (v === undefined ? true : v === 'true' || v === true), z.boolean())
    .default(true),
  METRICS_PORT: z.coerce.number().int().positive().default(9091),
  METRICS_HOST: z.string().default('0.0.0.0'),
  // Bull Board (queue inspector) is mounted on the metrics port too, behind
  // basic auth. Leave the password unset to disable it entirely.
  BULLBOARD_ENABLED: z
    .preprocess((v) => (v === undefined ? false : v === 'true' || v === true), z.boolean())
    .default(false),
  BULLBOARD_USER: z.string().default('admin'),
  BULLBOARD_PASSWORD: z.preprocess((v) => (v === '' ? undefined : v), z.string().optional()),

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

/**
 * Should THIS process run the BullMQ workers?
 *
 * In production the API and worker are separate containers and WORKER_MODE is
 * set explicitly on each. In development it is usually unset, and a single
 * `npm run dev` process should both serve HTTP and drain the queues — so the
 * default there is "yes".
 */
export const RUNS_WORKERS: boolean =
  env.WORKER_MODE ?? env.NODE_ENV !== 'production';
