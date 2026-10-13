# Nari Surokkha (নারী সুরক্ষা)

A women's safety and emergency-response platform for Bangladesh:

- **Mobile app** (Expo / React Native, Android first, Bangla + English) — one-tap
  SOS with live location, offline SOS by SMS from the phone's own SIM, trusted
  contacts, on-device detection of "Help" / "বাঁচাও", shouting, crying and
  falls, Safe Route, incident reports with photos/videos, a responder mode.
- **API** (Fastify + Prisma + PostgreSQL/PostGIS + Redis/BullMQ + Socket.IO) —
  alerts, notification fan-out (SMS, push), responder dispatch, evidence
  storage, public tracking links, subscriptions and payments.
- **Admin portal** (React + Vite) — live SOS map and siren, alert handling,
  users, responders, roles, incidents heatmap, payment gateways, settings.

## Repository layout

| Path | What |
|---|---|
| `services/api/` | Backend API and background worker (same codebase; `dist/server.js` / `dist/worker.js`) |
| `apps/admin-portal/` | Admin web portal |
| `apps/mobile/` | Citizen + responder mobile app |
| `packages/shared/` | Shared TypeScript types, constants and zod schemas |
| `services/ml-training/` | Training pipelines for the on-device models (motion, keyword head) |
| `services/ml-service/` | Deprecated, not deployed (see its `DEPRECATED.md`) |
| `patches/` | `patch-package` fixes for native libraries (applied on `npm install`) |
| `docker-compose.yml` | **Local development** stack |
| `docker-compose.prod.yml` | Production stack for a single VPS |
| `deploy/` | Production (nginx, scripts, systemd, WAL-G) and staging configs + guides |
| `infra/monitoring/` | Prometheus, alert rules, Alertmanager, Grafana provisioning |
| `load/` | k6 load tests |
| `docs/` | Documentation (index below); old dated reports are in `docs/reports/` |

## Requirements

- **Node.js 22 LTS** (≥ 22.12; `.nvmrc`) and npm ≥ 10
- Docker with the Compose plugin (for Postgres/PostGIS, Redis, MinIO)
- Mobile: Android Studio + SDK, JDK 17 (native modules need a development
  build, not Expo Go)

## Quick start

### 1. Install

```bash
npm ci                       # all workspaces from the root lockfile; applies patches/
npm run build --workspace=packages/shared
```

### 2. Start the databases

```bash
npm run docker:up            # = docker compose up -d postgres redis minio minio-init
```

PostGIS 16 on `127.0.0.1:5432` (`nari_user` / `nari_dev_password`, db
`nari_surokkha_dev`), Redis on `127.0.0.1:6379` (password `nari_dev_redis`),
MinIO on `127.0.0.1:9000` (console `:9001`, `minioadmin`/`minioadmin`). Override
any of these in a root `.env` (see `.env.example`).

### 3. API

```bash
cd services/api
cp .env.example .env
```

Edit `.env` to match the dev stack:

```dotenv
DATABASE_URL=postgresql://nari_user:nari_dev_password@localhost:5432/nari_surokkha_dev?schema=public
DIRECT_DATABASE_URL=postgresql://nari_user:nari_dev_password@localhost:5432/nari_surokkha_dev?schema=public
REDIS_URL=redis://:nari_dev_redis@localhost:6379
CORS_ORIGINS=http://localhost:5174,http://localhost:8081
WS_CORS_ORIGINS=http://localhost:5174,http://localhost:8081
```

`DIRECT_DATABASE_URL` is required by Prisma (`directUrl` in `schema.prisma`);
without PgBouncer it equals `DATABASE_URL`. JWT secrets must be ≥ 64 characters.

```bash
npx prisma migrate deploy    # apply migrations (never use `prisma db push`)
npx prisma generate          # regenerate the client after every schema change / pull
npm run prisma:seed          # roles + dev demo accounts (development only)
npm run dev                  # http://localhost:3001  (HTTP + workers in one process)
```

Health: `curl localhost:3001/health/ready`. API docs (Swagger) are served by the
API in development. With the mock SMS provider, `POST /api/v1/auth/otp/request`
returns the code as `devCode` (development only).

### 4. Admin portal

```bash
cd apps/admin-portal
cp .env.example .env         # VITE_API_URL=http://localhost:3001/api/v1, VITE_WS_URL=http://localhost:3001
npm run dev                  # http://localhost:5174
```

Dev login (from the seed): `superadmin@nari.test` / `Test@1234`.

### 5. Mobile app

```bash
cd apps/mobile
# In development the app finds the API on the Metro host's IP (port 3001,
# or EXPO_PUBLIC_API_PORT). To pin it, set e.g.:
#   echo "EXPO_PUBLIC_API_URL=http://192.168.x.y:3001/api/v1" > .env
npx expo prebuild --clean    # generates android/ (git-ignored) from app.json + plugins
npx expo run:android         # development build on a device/emulator
```

`android/` and `ios/` are generated — never edit or commit them; re-run
`prebuild --clean` after changing `app.json`, plugins or native dependencies.

### Everything in containers (alternative)

```bash
docker compose --profile app up -d --build    # API on :3001, portal on :8080
```

The API container applies migrations and the seed on start.

## Tests and checks

| What | Command |
|---|---|
| API unit tests | `cd services/api && npm run test:unit` |
| API all tests (needs the dev DB + Redis) | `cd services/api && npm test` |
| API type-check / lint | `npm run type-check` / `npm run lint` (in `services/api`) |
| Portal type-check / lint / build | `cd apps/admin-portal && npx tsc -b && npm run lint && npm run build` |
| Mobile type-check / tests | `cd apps/mobile && npx tsc --noEmit -p . && npm test` |
| Shared package | `npm run lint --workspace=packages/shared && npm run build --workspace=packages/shared` |
| Everything | `npm run lint`, `npm test`, `npm run type-check` at the root |
| Load tests | see `load/README.md` |

CI (`.github/workflows/ci.yml`) runs all of these on Node 22, applies every
migration to a real PostGIS database, builds both Docker images and validates
the compose files and shell scripts.

## Deployment

- Production (single VPS, Docker Compose, GitHub Actions on `v*` tags):
  [`deploy/production/VPS_DEPLOYMENT.md`](deploy/production/VPS_DEPLOYMENT.md).
  The short path is: `vps-setup.sh` (root) → `init-env.sh <domain>` → `issue-certs.sh <domain> <email>` (root)
  → `deploy.sh` → `create-admin`. All scripts are in `deploy/production/scripts/`.
- Staging: [`deploy/STAGING_README.md`](deploy/STAGING_README.md)
- Without Docker: [`deploy/NATIVE_VPS_DEPLOY.md`](deploy/NATIVE_VPS_DEPLOY.md)
- Environment variables and overview: [`docs/deployment/README.md`](docs/deployment/README.md)
- Backups and point-in-time recovery: [`docs/operations/backup-and-restore.md`](docs/operations/backup-and-restore.md)

## Documentation

| Doc | Topic |
|---|---|
| [`APP_REVIEW_2026-10-12.md`](APP_REVIEW_2026-10-12.md) | Latest full application review |
| [`docs/architecture/overview.md`](docs/architecture/overview.md) | Architecture |
| [`docs/api/README.md`](docs/api/README.md) | API |
| [`docs/EMERGENCY_DETECTION.md`](docs/EMERGENCY_DETECTION.md) | On-device detection, accuracy, data limitations |
| [`docs/PAYMENTS.md`](docs/PAYMENTS.md) | SSLCommerz / Stripe subscriptions |
| [`docs/INCIDENT_MEDIA.md`](docs/INCIDENT_MEDIA.md) | Incident photos/videos |
| [`docs/DATA_PROTECTION.md`](docs/DATA_PROTECTION.md) | Data protection and retention |
| [`docs/ML_BATTERY_USAGE.md`](docs/ML_BATTERY_USAGE.md) | Detection battery cost |
| [`docs/store-release.md`](docs/store-release.md) | Google Play / App Store declarations and open decisions |
| [`docs/testing/README.md`](docs/testing/README.md) | Testing strategy |
| [`docs/reports/`](docs/reports/) | Historical reports |

## License

UNLICENSED — proprietary; all rights reserved.
