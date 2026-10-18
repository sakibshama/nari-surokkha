#!/usr/bin/env bash
# ============================================================
# Bring an EXISTING .env.production up to date for this version.
#
#   bash deploy/production/scripts/upgrade-env.sh
#
# Adds only settings that are missing, with generated secrets where needed.
# Never changes a value you already have. Keeps a dated backup copy.
# ============================================================
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
TARGET="${ENV_FILE:-${APP_DIR}/.env.production}"
[[ -f "${TARGET}" ]] || { echo "❌ ${TARGET} not found (fresh install? use init-env.sh)" >&2; exit 1; }
command -v openssl >/dev/null || { echo "❌ openssl is required" >&2; exit 1; }

has_key() { grep -qE "^$1=" "${TARGET}"; }
get_val() { awk -F= -v k="$1" '$1 == k { sub(/^[^=]*=/, ""); v = $0 } END { print v }' "${TARGET}"; }

BACKUP="${TARGET}.bak-$(date +%Y%m%d-%H%M%S)"
cp -p "${TARGET}" "${BACKUP}"
chmod 600 "${BACKUP}"

DOMAIN="$(get_val DOMAIN)"
[[ -n "${DOMAIN}" ]] || { echo "❌ DOMAIN is not set in ${TARGET}" >&2; exit 1; }

added=()
header_written=0
add() {
  local key="$1" value="$2" comment="$3"
  if has_key "${key}" && [[ -n "$(get_val "${key}")" ]]; then return; fi
  if (( ! header_written )); then
    printf '\n# ─── Added by upgrade-env.sh on %s ───\n' "$(date +%Y-%m-%d)" >> "${TARGET}"
    header_written=1
  fi
  if has_key "${key}"; then
    # Present but empty: fill it in place.
    K="${key}" V="${value}" awk 'BEGIN{k=ENVIRON["K"];v=ENVIRON["V"]} index($0,k"=")==1 && !d {print k"="v; d=1; next} {print}' \
      "${TARGET}" > "${TARGET}.tmp" && cat "${TARGET}.tmp" > "${TARGET}" && rm -f "${TARGET}.tmp"
  else
    printf '\n# %s\n%s=%s\n' "${comment}" "${key}" "${value}" >> "${TARGET}"
  fi
  added+=("${key}")
}

add TURN_SECRET "$(openssl rand -hex 32)" "TURN relay shared secret (coturn use-auth-secret); clients get 1-hour credentials"
add TURN_HOST "api.${DOMAIN}" "Public host clients relay through"
add TRUST_PROXY "1" "nginx is the single trusted proxy hop (real client IP for rate limits)"
add EVIDENCE_URL_SECRET "$(openssl rand -hex 32)" "Signs local evidence URLs (they expire)"
# Existing mobile app versions register without an SMS code. Keep sign-up
# working for them; switch to "required" once the new app is released and
# the SMS gateway is configured in the admin portal.
add PHONE_VERIFICATION "optional" "Phone OTP at sign-up: optional now, set to required after the new app release"
add CONFIG_ENCRYPTION_KEY "$(openssl rand -hex 32)" "Encrypts SMS/payment secrets stored in the database (back this up!)"
add ADMIN_VITE_API_URL "https://api.${DOMAIN}/api/v1" "Admin portal build-time API URL"
add PUBLIC_WS_URL "https://api.${DOMAIN}" "Admin portal build-time realtime URL"
# Compose validates every service, including the optional monitoring profile.
add GRAFANA_PASSWORD "$(openssl rand -hex 16)" "Grafana admin password (monitoring profile)"
if ! has_key DIRECT_DATABASE_URL || [[ -z "$(get_val DIRECT_DATABASE_URL)" ]]; then
  PG_USER="$(get_val POSTGRES_USER)"; PG_PASS="$(get_val POSTGRES_PASSWORD)"; PG_DB="$(get_val POSTGRES_DB)"
  add DIRECT_DATABASE_URL "postgresql://${PG_USER}:${PG_PASS}@postgres:5432/${PG_DB}" "Migrations connect to Postgres directly (not through PgBouncer)"
fi

chmod 600 "${TARGET}"
echo "✅ Backup of your previous settings: ${BACKUP}"
if (( ${#added[@]} )); then
  echo "✅ Added: ${added[*]}"
else
  echo "✅ Nothing to add — your settings are already up to date."
fi
if [[ " ${added[*]} " == *" CONFIG_ENCRYPTION_KEY "* ]]; then
  echo "⚠️  A new CONFIG_ENCRYPTION_KEY was generated: copy it to your password manager."
fi
echo "ℹ️  No longer used (safe to delete): ML_SERVICE_URL, ML_SERVICE_API_KEY, TURN_USERNAME, TURN_PASSWORD"
