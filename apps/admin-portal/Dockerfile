# syntax=docker/dockerfile:1.7
# ============================================================
# Nari Surokkha — Admin portal image (static build served by nginx)
#
# Build from the REPOSITORY ROOT:
#   docker build -f apps/admin-portal/Dockerfile \
#     --build-arg VITE_API_URL=https://api.example.com/api/v1 \
#     --build-arg VITE_WS_URL=https://api.example.com .
# ============================================================

ARG NODE_IMAGE=node:22-alpine

# ─── 1. Build ───────────────────────────────────────────────
FROM ${NODE_IMAGE} AS builder
WORKDIR /app

# Vite bakes these into the bundle (and into the CSP <meta>) at BUILD time,
# so they must be provided as build args (docker-compose.prod.yml / deploy.yml).
ARG VITE_API_URL
ARG VITE_WS_URL
ARG VITE_CSP_EXTRA=""
ENV VITE_API_URL=$VITE_API_URL \
    VITE_WS_URL=$VITE_WS_URL \
    VITE_CSP_EXTRA=$VITE_CSP_EXTRA

# Manifests first for layer caching (apps/mobile is .dockerignored).
COPY package.json package-lock.json .npmrc ./
COPY apps/admin-portal/package.json ./apps/admin-portal/
COPY services/api/package.json ./services/api/
COPY packages/shared/package.json ./packages/shared/

# Only the portal + shared workspaces (+ root, for the patch-package hook).
RUN npm ci -w apps/admin-portal -w packages/shared --include-workspace-root

# recharts needs its peer `react-is`, which the portal does not declare. In a
# full monorepo install it is hoisted from the mobile app's dependency tree, so
# a portal-only install lacks it and `vite build` fails to resolve it. Until
# apps/admin-portal/package.json lists react-is, add the exact lockfile
# version here (no-op once it is a real dependency).
RUN if ! node -e "require.resolve('react-is/package.json', { paths: ['apps/admin-portal'] })" 2>/dev/null; then \
      V="$(node -p "require('./package-lock.json').packages['node_modules/react-is'].version")" \
      && cd /tmp && npm pack --silent "react-is@${V}" \
      && mkdir -p /app/node_modules/react-is \
      && tar -xzf "react-is-${V}.tgz" -C /app/node_modules/react-is --strip-components=1 \
      && rm -f "react-is-${V}.tgz"; \
    fi

COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/admin-portal ./apps/admin-portal

RUN npm --workspace=packages/shared run build \
 && npm --workspace=apps/admin-portal run build

# ─── 2. Serve: unprivileged nginx (runs as uid 101, listens on 8080) ───
FROM nginxinc/nginx-unprivileged:1.28-alpine AS runtime

COPY apps/admin-portal/nginx.conf /etc/nginx/conf.d/default.conf
# A non-root process cannot bind port 80. Rewrite the portal's listen port to
# 8080 so the image works whether or not nginx.conf has been updated yet.
USER root
RUN sed -i -E 's/listen[[:space:]]+80;/listen 8080;/' /etc/nginx/conf.d/default.conf
USER nginx

COPY --from=builder --chown=nginx:nginx /app/apps/admin-portal/dist /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/ >/dev/null || exit 1

CMD ["nginx", "-g", "daemon off;"]
