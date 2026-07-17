# Deployment Documentation

This directory contains deployment guides for all environments.

## Environments

| Environment | Purpose | Phase |
|-------------|---------|-------|
| Local (Docker Compose) | Development | 1+ |
| Staging | Testing before production | 21 |
| Production | Live system | 22 |

## Pre-Deployment Checklist

Before deploying to ANY environment:

- [ ] All tests pass (`npm test`)
- [ ] TypeScript builds without errors (`npm run build`)
- [ ] `.env` file configured (NOT committed to git)
- [ ] Database migrations reviewed and tested
- [ ] Security review completed (Phase 20)
- [ ] Evidence bucket access policy verified
- [ ] JWT secrets rotated from defaults
- [ ] Admin password changed from default

## Local Development (Current Phase)

```bash
# Start infrastructure
npm run docker:up

# Check infrastructure is healthy
docker compose -f infra/docker/docker-compose.dev.yml ps

# View logs
npm run docker:logs
```

## Staging Deployment (Phase 21)

See `staging.md` (created in Phase 21).

## Production Deployment (Phase 22)

See `production.md` (created in Phase 22).

## Rollback Procedure

In case of a failed deployment:

```bash
# 1. Stop the failing service
docker compose down api

# 2. Roll back to previous image
docker compose up -d --no-deps api:previous-tag

# 3. Roll back database migration (if needed)
cd services/api
npx prisma migrate resolve --rolled-back <migration_name>

# 4. Notify team and create incident report
```

> [!CAUTION]
> Never rollback database migrations in production without a backup verified first.
