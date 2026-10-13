# syntax=docker/dockerfile:1.7
# ============================================================
# Nari Surokkha — API / worker image
#
# Build from the REPOSITORY ROOT (the API is an npm workspace and imports
# @nari-surokkha/shared):
#   docker build -f services/api/Dockerfile .
#
# The same image runs both roles:
#   API     : default CMD (node dist/server.js)
#   worker  : command ["node", "dist/worker.js"] with WORKER_MODE=true
#   migrate : npx prisma migrate deploy      (prisma CLI is installed globally,
#   seed    : npm run prisma:seed             pinned to the lockfile versions)
# ============================================================

ARG NODE_IMAGE=node:22-alpine

# ─── 1. Build: full (dev) install of only the workspaces this image needs ───
FROM ${NODE_IMAGE} AS builder
WORKDIR /app

# OpenSSL is required by Prisma's engines on Alpine.
RUN apk add --no-cache openssl

# Manifests first for layer caching. apps/mobile is .dockerignored; npm ci
# still accepts the lockfile because the workspaces we install are present.
COPY package.json package-lock.json .npmrc ./
COPY services/api/package.json ./services/api/
COPY packages/shared/package.json ./packages/shared/
COPY apps/admin-portal/package.json ./apps/admin-portal/

# --include-workspace-root brings in patch-package for the root postinstall.
# The patches/ folder is deliberately NOT copied yet (mobile-only patches).
RUN npm ci -w services/api -w packages/shared --include-workspace-root

COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY services/api ./services/api

RUN npm --workspace=packages/shared run build

WORKDIR /app/services/api
RUN npx prisma generate && npm run build

# ─── 2. Runtime: production dependencies only, non-root ─────
FROM ${NODE_IMAGE} AS runtime
WORKDIR /app

RUN apk add --no-cache openssl tini

ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false

COPY package.json package-lock.json .npmrc ./
COPY services/api/package.json ./services/api/
COPY packages/shared/package.json ./packages/shared/
COPY apps/admin-portal/package.json ./apps/admin-portal/

# Production deps only. --ignore-scripts skips the root patch-package hook and
# @prisma/client's postinstall (the generated client is copied from the
# builder below); argon2 ships a musl prebuild, so nothing needs compiling.
#
# The prisma CLI and tsx are devDependencies of the API, but production still
# needs `prisma migrate deploy` and the roles-only seed. Install them globally
# at EXACTLY the lockfile versions so they match the generated client.
RUN npm ci --omit=dev --ignore-scripts -w services/api -w packages/shared \
 && PRISMA_V="$(node -p "require('./package-lock.json').packages['node_modules/prisma'].version")" \
 && TSX_V="$(node -p "require('./package-lock.json').packages['node_modules/tsx'].version")" \
 && npm install -g "prisma@${PRISMA_V}" "tsx@${TSX_V}" \
 && npm cache clean --force

# Generated Prisma client (+ query engine for linux-musl-openssl-3.0.x).
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/services/api/dist ./services/api/dist
COPY --from=builder /app/services/api/prisma ./services/api/prisma

# Local evidence storage (STORAGE_PROVIDER=local). When bind-mounting a host
# directory here, make it writable by uid 1000 (`chown -R 1000:1000 <dir>`).
RUN mkdir -p /app/uploads /app/services/api/uploads \
 && chown -R node:node /app/uploads /app/services/api/uploads

USER node
WORKDIR /app/services/api

EXPOSE 3001 9091

# API liveness. The worker overrides this in compose (it has no HTTP port,
# only the metrics server on 9091). 127.0.0.1, not localhost: Alpine resolves
# localhost to ::1 and Node listens on IPv4.
HEALTHCHECK --interval=20s --timeout=5s --start-period=30s --retries=5 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-3001}/health/live" >/dev/null || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
