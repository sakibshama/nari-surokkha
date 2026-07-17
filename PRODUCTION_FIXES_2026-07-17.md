# Production Fix — API failed to start on VPS (2026-07-17)

## Root cause (why the container crashed / image failed)

The API worked in dev (`tsx`) but not as a compiled production image. Three
build/runtime defects, all in `services/api`:

1. **Path aliases never resolved in compiled output.**
   53 source files import via `@/...` (e.g. `import { env } from '@/config/env'`).
   The build was a plain `tsc`, with no alias rewriting. So `dist/*.js` contained
   `require("@/config/env")`, which Node cannot resolve at runtime →
   `Error: Cannot find module '@/config/env'` the moment `node dist/server.js` runs.
   This is the crash.

2. **`"type": "module"` over CommonJS output.**
   `services/api/package.json` declared `"type": "module"`, but `tsc` emits
   CommonJS (root `tsconfig.base.json` → `module: CommonJS`). Node then loaded the
   CJS output as ESM → `ReferenceError: exports is not defined` at load.

3. **Test files compiled into the production build.**
   `tsconfig.json` includes all of `src`, including `src/__tests__`. `npm run build`
   (`tsc`) therefore type-checked tests and failed the image build on test-only errors.

## Fixes applied

- Added **`tsc-alias`** (devDependency) and changed the build to
  `tsc -p tsconfig.build.json && tsc-alias -p tsconfig.build.json`, so `@/...`
  imports are rewritten to real relative paths in `dist/`.
- Added `"baseUrl": "."` to `services/api/tsconfig.json` for alias resolution.
- Removed `"type": "module"` from `services/api/package.json` (output is CommonJS,
  consistent with the shared package and root).
- Renamed ESM-only files so lint/scripts still work as ESM without the module type:
  `eslint.config.js → eslint.config.mjs`, `scripts/gen-hash.js → scripts/gen-hash.mjs`.
- Added **`services/api/tsconfig.build.json`** that excludes tests from the
  production build (tests still run under vitest).
- Updated `package-lock.json` so `npm ci` (used by CI) stays in sync with the new
  dependency.

## Audited and confirmed OK (no changes needed)

- `docker-compose.prod.yml` — services, healthchecks, internal network, volumes.
- nginx template — subdomain routing (api./admin./police.), TLS, WebSocket upgrade.
- Dockerfiles (api, admin-portal, police-portal, ml-service).
- Prisma — default client output is copied into the runtime stage; builder and
  runtime share `node:20-alpine`, so the query engine matches.
- Route prefixes — `/health/live` (healthcheck) and `/api/v1/*` (portals) line up.

## Redeploy on the VPS

```bash
cd /opt/nari-surokkha
git pull          # get these fixes

COMPOSE="docker compose -f docker-compose.prod.yml --env-file .env.production"
$COMPOSE build api
$COMPOSE run --rm api npx prisma migrate deploy   # if migrations pending
$COMPOSE up -d
$COMPOSE logs -f api        # should show "running", NOT "Cannot find module '@/...'"
curl -s http://localhost:3001/health/live
```

## Notes

- Before committing, delete the stale git lock left by an interrupted process:
  `del .git\index.lock` (Windows) / `rm -f .git/index.lock`.
- A partial `node_modules/` may exist locally; harmless (git/Docker ignore it).
  Run `npm install` locally to complete it if you develop on this machine.
- Feature-completeness gaps flagged in the old health report (outbound SMS to
  non-app contacts, mocked ML endpoints) are separate from this deploy fix and
  still worth addressing before real users rely on them.
