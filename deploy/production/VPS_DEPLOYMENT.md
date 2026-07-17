# Nari Surokkha — VPS Production Deployment (via GitHub)

Single-VPS deployment using Docker Compose, with automated deploys from GitHub
Actions (build images → push to GHCR → SSH deploy → migrate → restart).

> This is a mission-critical emergency system. Do a full run-through on a
> staging server before pointing real users at it.

---

## What runs on the VPS

| Service | Image | Exposed |
|---|---|---|
| PostgreSQL + PostGIS | `postgis/postgis` | internal |
| Redis | `redis` | internal |
| API (Fastify) | `…/api` | via nginx → `api.<domain>` |
| ML service (FastAPI) | `…/ml-service` | internal |
| Admin portal | `…/admin-portal` | via nginx → `admin.<domain>` |
| Police portal | `…/police-portal` | via nginx → `police.<domain>` |
| Nginx (TLS + proxy) | `nginx` | 80 / 443 |

The **mobile app is not deployed here** — build it with EAS/Expo and point it at
`https://api.<domain>/api/v1`.

---

## 0. Prerequisites

- A VPS (2 vCPU / 4 GB RAM minimum) running Ubuntu 22.04+.
- A domain with three A-records pointing at the VPS IP:
  `api.<domain>`, `admin.<domain>`, `police.<domain>`.
- This repo on GitHub.

## 1. Bootstrap the VPS

```bash
sudo bash deploy/production/scripts/vps-setup.sh   # installs docker, certbot, ufw, dirs
sudo git clone <your-repo-url> /opt/nari-surokkha
cd /opt/nari-surokkha
```

## 2. Configure secrets

```bash
cp .env.production.example .env.production
nano .env.production          # fill EVERY value; generate secrets with openssl (see the file header)
```

Key rules: `NODE_ENV=production`, `CORS_ORIGINS`/`WS_CORS_ORIGINS` must be the
explicit portal URLs (wildcards are rejected in production), and
`CONFIG_ENCRYPTION_KEY` must be set (else SMS keys can't be saved).

## 3. Issue TLS certificates (one time)

Port 80 must be free, so do this before starting nginx:

```bash
sudo certbot certonly --standalone --cert-name <domain> \
  -d api.<domain> -d admin.<domain> -d police.<domain>
```

Certs land in `/etc/letsencrypt/live/<domain>/` (mounted read-only into nginx).

## 4. First deploy (manual)

```bash
COMPOSE="docker compose -f docker-compose.prod.yml --env-file .env.production"
$COMPOSE build          # or `$COMPOSE pull` if images already in GHCR
$COMPOSE run --rm api npx prisma migrate deploy
$COMPOSE up -d
$COMPOSE run --rm api npm run prisma:seed   # optional: seed roles/admin
$COMPOSE ps
```

Verify: `https://api.<domain>/health` returns `{"status":"ok", …}` and the two
portals load over HTTPS.

## 5. Wire up GitHub Actions (automated deploys)

In the repo → **Settings → Secrets and variables → Actions**:

**Secrets**
| name | value |
|---|---|
| `VPS_HOST` | server IP / hostname |
| `VPS_USER` | ssh user (e.g. `deploy`) |
| `VPS_SSH_KEY` | private key for that user |
| `VPS_PORT` | ssh port (optional, default 22) |
| `VPS_APP_DIR` | `/opt/nari-surokkha` |

**Variables**
| name | value |
|---|---|
| `PUBLIC_API_URL` | `https://api.<domain>/api/v1` |
| `PUBLIC_WS_URL` | `https://api.<domain>` |

`GITHUB_TOKEN` is automatic. Make sure the VPS user can run `docker` and that
GHCR packages are readable (public, or `docker login ghcr.io` on the VPS once).

## 6. Deploy from GitHub

```bash
git tag v1.0.0 && git push origin v1.0.0
```

`deploy.yml` builds+pushes images, SSHes in, pulls, runs `prisma migrate
deploy`, and restarts. Watch progress in the **Actions** tab. (You can also run
it manually via **workflow_dispatch**.)

## 7. Certificate renewal + backups (cron)

```bash
# TLS renewal (webroot; nginx stays up). Twice daily is standard.
0 3 * * * certbot renew --webroot -w /opt/nari-surokkha/data/certbot-www \
  --deploy-hook "docker compose -f /opt/nari-surokkha/docker-compose.prod.yml exec -T nginx nginx -s reload"

# Nightly DB + evidence backup
0 2 * * * cd /opt/nari-surokkha && bash deploy/production/scripts/backup.sh >> backups/backup.log 2>&1
```

---

## Operations

```bash
COMPOSE="docker compose -f docker-compose.prod.yml --env-file .env.production"
$COMPOSE logs -f api            # tail API logs
$COMPOSE ps                     # status
$COMPOSE restart api            # restart a service
$COMPOSE down                   # stop everything (data volumes persist)
```

**Rollback:** images are tagged with the git SHA. Re-run the deploy from an
earlier tag, or on the VPS set `TAG=<previous-sha>` and `$COMPOSE up -d`.

**Health:** `GET https://api.<domain>/health` reports `database`, `redis`, and
`storage` status (503 if any is down) — wire it into UptimeRobot/monitoring.

---

## Still to do before real users (not blockers for staging)

- Full end-to-end test: real SMS delivery, push, evidence upload/playback, and
  the motion model on a physical phone.
- `ml-service` audio-distress and safe-route are still mock endpoints (motion
  detection is real and on-device). Integrate real models or hide those
  features until ready.
- Consider offsite backup replication and a monitoring stack (Sentry is wired
  via `SENTRY_DSN`).
