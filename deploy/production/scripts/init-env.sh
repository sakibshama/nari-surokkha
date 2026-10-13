#!/usr/bin/env bash
# ============================================================
# Create .env.production from .env.production.example with strong random
# secrets, URLs derived from your domain and Postgres sized to this server.
#
#   bash deploy/production/scripts/init-env.sh example.com
#   bash deploy/production/scripts/init-env.sh example.com --force   # overwrite
#
# Optional settings left for you to fill afterwards are listed at the end.
# ============================================================
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
EXAMPLE="${APP_DIR}/.env.production.example"
TARGET="${ENV_FILE:-${APP_DIR}/.env.production}"

DOMAIN="${1:-}"
FORCE="${2:-}"

if [[ -z "${DOMAIN}" ]]; then
  read -r -p "Your domain (e.g. example.com — api. and admin. are added): " DOMAIN
fi
DOMAIN="${DOMAIN#https://}"; DOMAIN="${DOMAIN#http://}"; DOMAIN="${DOMAIN%/}"
if [[ ! "${DOMAIN}" =~ ^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]]; then
  echo "❌ '${DOMAIN}' is not a domain name." >&2
  exit 1
fi
if [[ -e "${TARGET}" && "${FORCE}" != "--force" ]]; then
  echo "❌ ${TARGET} already exists. Re-run with --force to overwrite (all secrets change!)." >&2
  exit 1
fi
command -v openssl >/dev/null || { echo "❌ openssl is required" >&2; exit 1; }

hex() { openssl rand -hex "$1"; }

# Replace the first `KEY=...` line (or append it). Values are passed through
# the environment so no character in them needs escaping.
set_var() {
  local key="$1" value="$2" tmp
  tmp="$(mktemp)"
  K="${key}" V="${value}" awk '
    BEGIN { k = ENVIRON["K"]; v = ENVIRON["V"]; done = 0 }
    !done && index($0, k "=") == 1 { print k "=" v; done = 1; next }
    { print }
    END { if (!done) print k "=" v }
  ' "${TARGET}" > "${tmp}"
  cat "${tmp}" > "${TARGET}"
  rm -f "${tmp}"
}

umask 077
cp "${EXAMPLE}" "${TARGET}"
chmod 600 "${TARGET}"

# ─── Secrets (hex only: safe inside URLs and YAML) ─────────────
PG_PASS="$(hex 24)"
REDIS_PASS="$(hex 24)"
PG_USER="nari_user"
PG_DB="nari_surokkha"

set_var DOMAIN "${DOMAIN}"
set_var REGISTRY "nari-surokkha"
set_var TAG "latest"
set_var API_BASE_URL "https://api.${DOMAIN}"
set_var POSTGRES_DB "${PG_DB}"
set_var POSTGRES_USER "${PG_USER}"
set_var POSTGRES_PASSWORD "${PG_PASS}"
set_var DATABASE_URL "postgresql://${PG_USER}:${PG_PASS}@pgbouncer:5432/${PG_DB}?pgbouncer=true&connection_limit=10"
set_var DIRECT_DATABASE_URL "postgresql://${PG_USER}:${PG_PASS}@postgres:5432/${PG_DB}"
set_var REDIS_PASSWORD "${REDIS_PASS}"
set_var REDIS_URL "redis://:${REDIS_PASS}@redis:6379"
set_var JWT_SECRET "$(hex 48)"
set_var JWT_REFRESH_SECRET "$(hex 48)"
set_var CONFIG_ENCRYPTION_KEY "$(hex 32)"
set_var EVIDENCE_URL_SECRET "$(hex 32)"
set_var TURN_HOST "api.${DOMAIN}"
set_var TURN_SECRET "$(hex 32)"
set_var CORS_ORIGINS "https://admin.${DOMAIN}"
set_var WS_CORS_ORIGINS "https://admin.${DOMAIN}"
set_var ADMIN_VITE_API_URL "https://api.${DOMAIN}/api/v1"
set_var PUBLIC_WS_URL "https://api.${DOMAIN}"
set_var GRAFANA_PASSWORD "$(hex 16)"
set_var TRUST_PROXY "1"
set_var PHONE_VERIFICATION "required"
set_var LOG_PRETTY "false"

# ─── Evidence on this server's disk (switch to R2/S3 later if you like) ─
set_var STORAGE_PROVIDER "local"
set_var UPLOADS_DIR "${APP_DIR}/data/uploads"
set_var STORAGE_LOCAL_DIR "/app/uploads"

# ─── Size Postgres/Redis to this machine ───────────────────────
MEM_MB=4096
if [[ -r /proc/meminfo ]]; then
  MEM_MB=$(( $(awk '/^MemTotal:/ { print $2 }' /proc/meminfo) / 1024 ))
fi
set_var PG_SHARED_BUFFERS "$(( MEM_MB / 4 ))MB"
set_var PG_EFFECTIVE_CACHE_SIZE "$(( MEM_MB * 6 / 10 ))MB"
set_var PG_MEM_LIMIT "$(( MEM_MB / 2 ))m"
if (( MEM_MB < 6000 )); then
  set_var PG_WORK_MEM "8MB"
  set_var PG_MAX_CONNECTIONS "100"
  set_var REDIS_MAXMEMORY "256mb"
  set_var REDIS_MEM_LIMIT "384m"
  set_var API_MEM_LIMIT "768m"
  set_var WORKER_MEM_LIMIT "512m"
fi

echo "✅ Wrote ${TARGET} (mode 600) for ${DOMAIN}; Postgres sized for ${MEM_MB} MB RAM."
echo ""
echo "Optional — fill in ${TARGET} when you have them:"
echo "  • FIREBASE_*                 push notifications (recommended)"
echo "  • SMS_* / TWILIO_*           only as a fallback; configure SMS in the admin portal"
echo "  • BACKUP_*                   encrypted off-site backups (strongly recommended)"
echo "  • ALERT_WEBHOOK_URL          needed for the monitoring profile"
echo "  • STORAGE_PROVIDER + S3_*    to keep evidence in Cloudflare R2 / S3 instead of this disk"
echo ""
echo "⚠️  Copy CONFIG_ENCRYPTION_KEY to your password manager: without it, saved SMS and"
echo "    payment-gateway secrets cannot be read after a restore."
