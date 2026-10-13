# Production Readiness — Docker on VPS (2026-07-18)

## Verdict: READY, with 3 conditions

The Docker pathway (docker-compose.prod.yml) is sound end-to-end. Three
conditions must be met before `docker compose build` on the VPS produces a
working system.

---

## Condition 1 — COMMIT AND PUSH the local work (blocking)

29 modified files on the local machine are NOT in git. Docker builds from the
repo, so until these are pushed, images will miss: all Bengali/English i18n,
the gov-theme UI, both portals' tsconfig fixes (unused-var errors → build
failure), the admin-portal toolchain bump, and the new roles migration.

```
del .git\index.lock        # stale lock from an interrupted process
git add -A
git commit -m "i18n toggle, gov theme, portal build fixes, roles migration"
git push
```

This also explains the VPS "socketService is not exported" failure — the repo
copy exports it correctly; the VPS checkout predates the fixes.

## Condition 2 — roles migration (fixed in repo, verify once)

`schema.prisma` had a Role model but no migration created the `roles` table —
every fresh deploy broke at seed (this bit you on the VPS; you patched by
hand). Added `prisma/migrations/20260718000000_roles_and_rbac/` — idempotent
(IF NOT EXISTS), so it is safe on both your hand-patched VPS DB and brand-new
Docker volumes. Nothing to do beyond pushing it; `migrate deploy` handles it.

## Condition 3 — regenerate package-lock.json once (CI only)

`apps/admin-portal/package.json` was bumped to Vite 8 / plugin-react 6 / TS 6
(matching police-portal, which builds cleanly). The lockfile still has the old
resolution. Docker is unaffected (Dockerfiles use `npm install`), but CI's
`npm ci` will fail until the lock is regenerated:

```
npm install        # on any machine with normal network
git add package-lock.json && git commit -m "lockfile sync" && git push
```

---

## Verified working (no action)

| Area | Status |
|---|---|
| API Dockerfile | builds with tsconfig.build.json + tsc-alias; tests excluded; Prisma client copied to runtime stage; same alpine base both stages |
| Portal Dockerfiles | `tsc -b` now passes (unused-var flags relaxed); VITE_* build args flow in; nginx serves static |
| .dockerignore | blocks all `.env` files from images — committed localhost `.env`s cannot leak into builds |
| docker-compose.prod.yml | healthchecks, `:?required` env guards, internal-only network, named volumes, uploads bind-mount |
| Env contract | `HOST=0.0.0.0` for containers; CORS/WS origins explicit; JWT length enforced at boot |
| nginx template | 3 subdomains, TLS, WebSocket upgrade, ACME webroot |
| deploy.yml (CI/CD) | builds 4 images → GHCR → SSH deploy → migrate → restart; portal build args wired from repo vars |
| DB migrations | init (PostGIS + triggers), system_settings, ml_models, roles (new) — clean sequence for fresh DBs |
| Seed | real argon2id hashes; idempotent upserts |

## Cautions (not blockers)

- **Seeded test accounts use publicly-known credentials** (`Test@1234`, in the
  repo). In production either don't run the seed, or immediately change the
  admin password and disable the test citizen/responder/police accounts.
- **Never run `prisma db push` on this project** — the PostGIS geometry
  columns exist only in raw migration SQL; `db push` silently drops them
  (this happened once on the VPS; all 6 columns were restored by hand and are
  protected on fresh deploys by the init migration).
- ML service endpoints are mocked; outbound SMS needs provider config via the
  Admin Portal; push/S3 remain in mock mode without FIREBASE_*/AWS_* env.
- Current native (non-Docker) VPS install and a future Docker install must not
  fight over ports 80/443/3001 — stop `nari-api` + nginx sites before
  switching to the compose stack, or keep using the native setup (it works).

## Fresh-VPS Docker runbook (after push)

```
git clone <repo> /opt/nari-surokkha && cd /opt/nari-surokkha
cp .env.production.example .env.production && nano .env.production   # fill all
sudo certbot certonly --standalone --cert-name mystrix-soft.com \
  -d api.mystrix-soft.com -d admin.mystrix-soft.com -d police.mystrix-soft.com
COMPOSE="docker compose -f docker-compose.prod.yml --env-file .env.production"
$COMPOSE build
$COMPOSE run --rm api npx prisma migrate deploy
$COMPOSE up -d
$COMPOSE run --rm api npm run prisma:seed     # optional; see cautions
curl -s https://api.mystrix-soft.com/health
```
