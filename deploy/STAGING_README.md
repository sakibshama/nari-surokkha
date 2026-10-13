# Staging Deployment Guide

Staging runs the same images as production (`services/api/Dockerfile`,
`apps/admin-portal/Dockerfile`) with `NODE_ENV=staging`, which the API treats
like production for every safety check (no wildcard CORS, trustProxy = 1, phone
OTP required unless `PHONE_VERIFICATION=optional`, no demo seed data).

One host, one origin: nginx serves the admin portal at `/` and proxies `/api`,
`/socket.io`, `/t`, `/c` and `/health` to the API. A worker container runs the
background jobs.

## Prerequisites

- Docker Engine with the Compose plugin. Nothing else — migrations and the
  roles seed run inside the API container.

## 1. Configure

```bash
cp deploy/staging/.env.example deploy/staging/.env
nano deploy/staging/.env     # STAGING_URL, passwords, JWT secrets, CONFIG_ENCRYPTION_KEY
```

## 2. Start (from the repository root)

```bash
docker compose -f deploy/staging/docker-compose.staging.yml \
  --env-file deploy/staging/.env up -d --build
```

The API container applies migrations (`prisma migrate deploy`) and seeds the
system roles on every start, then serves HTTP. Postgres and Redis are not
published on the host.

## 3. Verify

```bash
API_URL=http://localhost deploy/scripts/healthcheck.sh      # /health/ready -> 200
```

- Admin portal: `STAGING_URL/`
- API: `STAGING_URL/api/v1`, health: `STAGING_URL/health/ready`

## 4. Test accounts

Demo users are **not** seeded on staging (it behaves like production). Register
through the app (with `PHONE_VERIFICATION=optional` and `SMS_PROVIDER=mock` no
SMS is needed), then promote one account to admin as described in
`deploy/production/VPS_DEPLOYMENT.md` → "First admin account".

To load the development demo data on a throwaway staging DB only:

```bash
docker compose -f deploy/staging/docker-compose.staging.yml --env-file deploy/staging/.env \
  run --rm -e ALLOW_DEV_SEED=true api npm run prisma:seed
```

## TLS

This compose listens on plain HTTP (`STAGING_HTTP_PORT`, default 80). Put it
behind a TLS terminator, or reuse the production nginx template, before
testing with real phones (Android blocks cleartext in release builds).
