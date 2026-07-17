#!/usr/bin/env bash
# ============================================================
# One-time VPS bootstrap for Nari Surokkha (Ubuntu/Debian).
# Run as root (or with sudo):  sudo bash vps-setup.sh
# ============================================================
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/nari-surokkha}"

echo "==> Updating packages"
apt-get update -y

echo "==> Installing Docker Engine + Compose plugin"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
apt-get install -y docker-compose-plugin git certbot ufw

echo "==> Firewall (allow SSH, HTTP, HTTPS)"
ufw allow OpenSSH || true
ufw allow 80/tcp || true
ufw allow 443/tcp || true
ufw --force enable || true

echo "==> Creating app + data directories at ${APP_DIR}"
mkdir -p "${APP_DIR}/data/uploads" "${APP_DIR}/data/certbot-www" "${APP_DIR}/backups"

echo ""
echo "Bootstrap complete. Next steps:"
echo "  1. git clone <your-repo> ${APP_DIR}   (if not already there)"
echo "  2. cp .env.production.example .env.production   and fill every value"
echo "  3. Point DNS A-records api./admin./police.<domain> at this server"
echo "  4. Issue TLS certs (stack DOWN so port 80 is free):"
echo "       certbot certonly --standalone --cert-name <domain> \\"
echo "         -d api.<domain> -d admin.<domain> -d police.<domain>"
echo "  5. Start the stack:"
echo "       docker compose -f docker-compose.prod.yml --env-file .env.production up -d"
echo "  6. Run migrations:"
echo "       docker compose -f docker-compose.prod.yml --env-file .env.production run --rm api npx prisma migrate deploy"
echo "  7. Seed an admin user (optional):"
echo "       docker compose -f docker-compose.prod.yml --env-file .env.production run --rm api npm run prisma:seed"
