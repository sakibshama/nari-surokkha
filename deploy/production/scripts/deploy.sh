#!/usr/bin/env bash
# ============================================================
# Deploy / update Nari Surokkha on this VPS.
#
#   bash deploy/production/scripts/deploy.sh          # build here, migrate, start
#   bash deploy/production/scripts/deploy.sh --pull   # use images from REGISTRY:TAG
#
# Run as the deploy user (docker group), after init-env.sh and issue-certs.sh.
# Safe to re-run: migrations are idempotent, containers are recreated only
# when their image or config changed.
# ============================================================
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
ENV_FILE="${ENV_FILE:-${APP_DIR}/.env.production}"
cd "${APP_DIR}"

PULL=0
for arg in "$@"; do
  case "${arg}" in
    --pull) PULL=1 ;;
    -h|--help) sed -n '2,11p' "$0"; exit 0 ;;
    *) echo "Unknown option: ${arg}" >&2; exit 2 ;;
  esac
done

ok()   { printf '  \033[32m✔\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
fail() { printf '  \033[31m✘\033[0m %s\n' "$*" >&2; exit 1; }
step() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

COMPOSE=(docker compose -f docker-compose.prod.yml --env-file "${ENV_FILE}")

# Read one value from the env file (last assignment wins, like Compose).
env_get() { awk -F= -v k="$1" '$1 == k { sub(/^[^=]*=/, ""); v = $0 } END { print v }' "${ENV_FILE}"; }

# ─── 1. Pre-flight ─────────────────────────────────────────────
step "Pre-flight checks"
command -v docker >/dev/null || fail "Docker is not installed (run deploy/production/scripts/vps-setup.sh)"
docker compose version >/dev/null 2>&1 || fail "The Docker Compose plugin is missing"
[[ -f "${ENV_FILE}" ]] || fail "${ENV_FILE} not found — run: bash deploy/production/scripts/init-env.sh <your-domain>"
[[ "$(stat -c %a "${ENV_FILE}")" == "600" ]] || { chmod 600 "${ENV_FILE}"; warn "Set ${ENV_FILE} to mode 600"; }

DOMAIN="$(env_get DOMAIN)"
[[ -n "${DOMAIN}" && "${DOMAIN}" != "example.com" ]] || fail "DOMAIN is not set in ${ENV_FILE}"
ok "Domain: ${DOMAIN}"

REQUIRED=(POSTGRES_PASSWORD REDIS_PASSWORD REDIS_URL JWT_SECRET JWT_REFRESH_SECRET CONFIG_ENCRYPTION_KEY
          DATABASE_URL DIRECT_DATABASE_URL TURN_SECRET API_BASE_URL CORS_ORIGINS ADMIN_VITE_API_URL PUBLIC_WS_URL)
for key in "${REQUIRED[@]}"; do
  value="$(env_get "${key}")"
  [[ -n "${value}" && "${value}" != *CHANGE_ME* ]] || fail "${key} is empty or still a placeholder in ${ENV_FILE}"
done
ok "Required settings present"

[[ "$(env_get STORAGE_PROVIDER)" != "local" && "$(env_get S3_ACCESS_KEY)" == *CHANGE_ME* ]] \
  && fail "STORAGE_PROVIDER is $(env_get STORAGE_PROVIDER) but S3_* is not filled in (or set STORAGE_PROVIDER=local)"
BACKUP_KEY="$(env_get BACKUP_AGE_RECIPIENT)$(env_get BACKUP_GPG_RECIPIENT)"
[[ -z "${BACKUP_KEY}" || "${BACKUP_KEY}" == *CHANGE_ME* ]] && warn "Backups are not configured yet (BACKUP_*) — do this before real users"
[[ -z "$(env_get FIREBASE_PROJECT_ID)" ]] && warn "FIREBASE_* empty — push notifications are off"

# DNS: both hostnames must point at this server, or certificates and the app fail.
PUBLIC_IP="$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)"
for host in "api.${DOMAIN}" "admin.${DOMAIN}"; do
  resolved="$(getent ahostsv4 "${host}" | awk 'NR == 1 { print $1 }')"
  if [[ -z "${resolved}" ]]; then
    fail "DNS: ${host} does not resolve — add an A record pointing at ${PUBLIC_IP:-this server}"
  elif [[ -n "${PUBLIC_IP}" && "${resolved}" != "${PUBLIC_IP}" ]]; then
    warn "DNS: ${host} → ${resolved}, but this server is ${PUBLIC_IP} (fine only behind a proxy/CDN)"
  else
    ok "DNS: ${host} → ${resolved}"
  fi
done

"${COMPOSE[@]}" config -q || fail "docker-compose.prod.yml / ${ENV_FILE} do not validate"
ok "Compose configuration valid"

RENEWAL="/etc/letsencrypt/renewal/${DOMAIN}.conf"
[[ -f "${RENEWAL}" ]] || fail "No TLS certificate for ${DOMAIN} yet — run once: sudo bash deploy/production/scripts/issue-certs.sh ${DOMAIN} <your-email>"
ok "TLS certificate present (automatic renewal configured)"

mkdir -p "${APP_DIR}/data/certbot-www" "${APP_DIR}/backups"
chmod 700 "${APP_DIR}/backups"
UPLOADS_DIR="$(env_get UPLOADS_DIR)"
mkdir -p "${UPLOADS_DIR:-${APP_DIR}/data/uploads}"

# ─── 3. Images ─────────────────────────────────────────────────
if [[ "${PULL}" == 1 ]]; then
  step "Pulling images $(env_get REGISTRY):$(env_get TAG)"
  "${COMPOSE[@]}" pull api worker admin-portal
else
  step "Building images on this server (takes a few minutes the first time)"
  "${COMPOSE[@]}" build api admin-portal
fi

# The app runs as uid 1000 inside the container; make the evidence directory
# writable for it (done through Docker, so no sudo is needed). Always done:
# without S3 credentials the app falls back to this directory whatever
# STORAGE_PROVIDER says, and refuses to start if it cannot write there.
"${COMPOSE[@]}" run --rm --no-deps --user root --entrypoint chown api -R 1000:1000 /app/uploads
ok "Evidence directory writable by the app"

# ─── 4. Database ───────────────────────────────────────────────
step "Starting the database, Redis and PgBouncer"
"${COMPOSE[@]}" up -d --wait postgres redis pgbouncer
ok "Data services healthy"

step "Applying database migrations"
"${COMPOSE[@]}" run --rm --no-deps api npx prisma migrate deploy
step "Seeding system roles (no demo users in production)"
"${COMPOSE[@]}" run --rm --no-deps api npm run prisma:seed

# ─── 5. Everything else ────────────────────────────────────────
step "Starting the application"
"${COMPOSE[@]}" up -d --remove-orphans --wait api worker admin-portal coturn nginx
ok "Containers healthy"

step "Smoke test over HTTPS"
for i in $(seq 1 30); do
  if curl -fsS --max-time 5 "https://api.${DOMAIN}/health/ready" >/dev/null 2>&1; then
    ok "https://api.${DOMAIN}/health/ready"
    break
  fi
  [[ "${i}" == 30 ]] && fail "API not reachable at https://api.${DOMAIN}/health/ready — see: docker compose -f docker-compose.prod.yml logs api nginx"
  sleep 2
done
if curl -fsS --max-time 5 -o /dev/null "https://admin.${DOMAIN}/"; then
  ok "https://admin.${DOMAIN}/"
else
  warn "Admin portal did not answer — see: docker compose -f docker-compose.prod.yml logs admin-portal nginx"
fi

ADMIN_SQL="SELECT count(*) FROM users u JOIN roles r ON r.id = u.role_id WHERE r.key = 'admin'"
ADMINS="$("${COMPOSE[@]}" exec -T postgres sh -c "psql -tA -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -c \"${ADMIN_SQL}\"" \
  2>/dev/null | tr -d '[:space:]' || echo '?')"

step "Done"
echo "  API:          https://api.${DOMAIN}/api/v1"
echo "  Admin portal: https://admin.${DOMAIN}"
if [[ "${ADMINS}" == "0" ]]; then
  echo ""
  echo "  No administrator yet. Create one now:"
  echo "    docker compose -f docker-compose.prod.yml --env-file .env.production run --rm api node dist/scripts/create-admin.js"
fi
