#!/usr/bin/env bash
# ============================================================
# One-time TLS certificates (Let's Encrypt) for api.<domain> and admin.<domain>.
# Run as root once DNS points at this server:
#
#   sudo bash deploy/production/scripts/issue-certs.sh example.com you@example.com
#
# Afterwards renewal is automatic (certbot.timer), through the running nginx
# (webroot), with an nginx reload after each renewal.
# ============================================================
set -euo pipefail

[[ "$(id -u)" == 0 ]] || { echo "Run as root: sudo bash $0 <domain> <email>" >&2; exit 1; }
DOMAIN="${1:?usage: issue-certs.sh <domain> <email>}"
EMAIL="${2:?usage: issue-certs.sh <domain> <email>}"
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
WEBROOT="${APP_DIR}/data/certbot-www"
COMPOSE="docker compose -f ${APP_DIR}/docker-compose.prod.yml --env-file ${APP_DIR}/.env.production"

for host in "api.${DOMAIN}" "admin.${DOMAIN}"; do
  getent ahostsv4 "${host}" >/dev/null || { echo "❌ ${host} does not resolve yet — add its DNS A record first." >&2; exit 1; }
done

if [[ -f "/etc/letsencrypt/renewal/${DOMAIN}.conf" ]]; then
  # Existing install: keep the certificate, just make sure renewal goes
  # through the running nginx (older setups renewed in standalone mode,
  # which fails while nginx holds port 80).
  echo "ℹ️  Certificates for ${DOMAIN} already exist — keeping them, updating the renewal method."
else
  # Standalone mode needs port 80; stop our nginx if an earlier attempt started it.
  if [[ -f "${APP_DIR}/.env.production" ]]; then
    ${COMPOSE} stop nginx >/dev/null 2>&1 || true
  fi
  certbot certonly --standalone --non-interactive --agree-tos -m "${EMAIL}" \
    --cert-name "${DOMAIN}" -d "api.${DOMAIN}" -d "admin.${DOMAIN}"
fi

# Renew through the running nginx (it serves /.well-known/acme-challenge/ from
# this directory) instead of standalone, which would need port 80 free.
mkdir -p "${WEBROOT}"
RENEWAL="/etc/letsencrypt/renewal/${DOMAIN}.conf"
sed -i 's/^authenticator = standalone$/authenticator = webroot/' "${RENEWAL}"
if ! grep -q '^webroot_path' "${RENEWAL}"; then
  printf 'webroot_path = %s,\n[[webroot_map]]\napi.%s = %s\nadmin.%s = %s\n' \
    "${WEBROOT}" "${DOMAIN}" "${WEBROOT}" "${DOMAIN}" "${WEBROOT}" >> "${RENEWAL}"
fi

HOOK=/etc/letsencrypt/renewal-hooks/deploy/nari-reload-nginx.sh
mkdir -p "$(dirname "${HOOK}")"
cat > "${HOOK}" <<HOOK
#!/bin/sh
# Installed by issue-certs.sh: pick up renewed certificates without downtime.
${COMPOSE} exec -T nginx nginx -s reload
HOOK
chmod +x "${HOOK}"
systemctl enable --now certbot.timer >/dev/null 2>&1 || true

echo "✅ Certificates ready for api.${DOMAIN} and admin.${DOMAIN}; renewal is automatic."
echo "   Test renewal later (stack running):  sudo certbot renew --dry-run"
