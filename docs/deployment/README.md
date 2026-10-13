# Deployment Documentation

| Environment | How | Guide |
|---|---|---|
| Local development | Root `docker-compose.yml` (PostGIS, Redis, MinIO; optional containerised API + portal) | [README.md](../../README.md#quick-start) |
| Staging | `deploy/staging/docker-compose.staging.yml` (`NODE_ENV=staging`) | [deploy/STAGING_README.md](../../deploy/STAGING_README.md) |
| Production (recommended) | `docker-compose.prod.yml` on one VPS, deployed by `.github/workflows/deploy.yml` from a `v*` tag | [deploy/production/VPS_DEPLOYMENT.md](../../deploy/production/VPS_DEPLOYMENT.md) |
| Production (no Docker) | systemd + host nginx | [deploy/NATIVE_VPS_DEPLOY.md](../../deploy/NATIVE_VPS_DEPLOY.md) |
| Backups / PITR | `backup.sh`, `restore-test.sh`, WAL-G override | [docs/operations/backup-and-restore.md](../operations/backup-and-restore.md) |
| App stores | Play / App Store declarations | [docs/store-release.md](../store-release.md) |

Files under `infra/legacy/` are old, unused copies — do not deploy them.

## Environment variables

The API validates every variable at start-up (`services/api/src/config/env.ts`)
and exits on an invalid configuration. Templates:

- `services/api/.env.example` — local `npm run dev`
- `.env.example` (root) — overrides for the root dev compose
- `deploy/staging/.env.example`
- `.env.production.example`

Variables added in October 2026:

| Variable | Default | Purpose |
|---|---|---|
| `DIRECT_DATABASE_URL` | falls back to `DATABASE_URL` in the app; **required by `prisma migrate`** (schema `directUrl`) | Direct Postgres connection for migrations (bypasses PgBouncer) |
| `NODE_ENV=staging` | — | Accepted; treated like production for safety checks |
| `PHONE_VERIFICATION` | `required` in production/staging, else `optional` | OTP needed before `/auth/register` |
| `TRUST_PROXY` | `1` in production/staging, else `false` | Fastify trustProxy; nginx overwrites X-Forwarded-For |
| `TURN_HOST`, `TURN_SECRET` | unset = STUN only | Short-lived TURN credentials (coturn `use-auth-secret`) |
| `EVIDENCE_URL_SECRET` | derived from `JWT_SECRET` | HMAC key for signed local evidence URLs |

Removed: `ML_SERVICE_URL`, `ML_SERVICE_API_KEY` (the ML service is not
deployed), `TURN_PASSWORD`/`TURN_USERNAME` (no static TURN credential is handed
out any more).

## Pre-deployment checklist

- [ ] CI is green on the commit being tagged (API, portal, mobile, migrations, Docker builds, deploy configs)
- [ ] `.env.production` filled; secrets generated with `openssl`, not copied from examples
- [ ] Migrations reviewed; a fresh backup exists and the last restore test passed
- [ ] `TURN_SECRET` set and ports 3478 + 49152–49200/udp open
- [ ] `ALERT_WEBHOOK_URL` set and a test alert received
- [ ] First admin created by promotion (no default passwords exist)

## Rollback

Re-run the deploy workflow with the previous tag (images and compose files are
versioned together). Prisma migrations are forward-only: if a migration must
be undone, restore the database from backup (see the backup guide) rather than
editing `_prisma_migrations` by hand.
