# Nari Surokkha API — services/api

Fastify Node.js TypeScript backend for the Nari Surokkha emergency safety platform.

## Tech Stack

- **Runtime**: Node.js 20+
- **Framework**: Fastify 4.x
- **Language**: TypeScript
- **ORM**: Prisma
- **Database**: PostgreSQL 16 + PostGIS
- **Cache/Queue**: Redis + BullMQ
- **Real-time**: Socket.IO
- **Auth**: JWT (argon2 password hashing)
- **Storage**: S3-compatible (MinIO for dev, AWS S3 / Cloudflare R2 for prod)

## Setup

```bash
# Install dependencies
npm install

# Copy env
cp .env.example .env
# Edit .env with your values

# Start infrastructure
cd ../../
npm run docker:up

# Run migrations (Phase 3 onwards)
npx prisma migrate dev

# Start development server
npm run dev
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server with hot reload |
| `npm run build` | TypeScript compile |
| `npm run start` | Start production server |
| `npm run test` | Run all tests |
| `npm run lint` | ESLint |
| `npm run type-check` | TypeScript type check |
| `npx prisma migrate dev` | Run DB migrations |
| `npx prisma studio` | Open Prisma DB explorer |

## Folder Structure (Phase 2 onwards)

```
services/api/
  src/
    config/        # Environment config validation
    plugins/       # Fastify plugins (db, redis, auth, websocket)
    modules/       # Feature modules (auth, alerts, users, etc.)
      auth/
        auth.routes.ts
        auth.controller.ts
        auth.service.ts
        auth.repository.ts
        auth.test.ts
    middleware/    # RBAC, rate limit, etc.
    utils/         # Helpers, response formatters
    types/         # Local TypeScript types
    server.ts      # Server bootstrap
    app.ts         # Fastify app factory
  prisma/
    schema.prisma
    migrations/
  Dockerfile
  package.json
```

## Health Check

```
GET /health
→ { "status": "ok", "db": "ok", "redis": "ok" }
```
