#!/usr/bin/env bash
# ============================================================
# One-time VPS bootstrap for Nari Surokkha (Ubuntu/Debian).
# Run as root (or with sudo):  sudo bash vps-setup.sh
# Full guide: deploy/production/VPS_DEPLOYMENT.md
# ============================================================
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/nari-surokkha}"
# Non-root account that owns the app and runs docker (also the CI deploy user).
DEPLOY_USER="${DEPLOY_USER:-deploy}"
# Swap is created only when the machine has less RAM than this and no swap yet.
SWAP_IF_RAM_BELOW_MB="${SWAP_IF_RAM_BELOW_MB:-8192}"
SWAP_SIZE="${SWAP_SIZE:-2G}"

[[ "$(id -u)" == 0 ]] || { echo "Run as root: sudo bash $0" >&2; exit 1; }
# Must match --min-port/--max-port of the coturn service in docker-compose.prod.yml.
TURN_RELAY_MIN="${TURN_RELAY_MIN:-49152}"
TURN_RELAY_MAX="${TURN_RELAY_MAX:-49200}"

echo "==> Updating packages"
apt-get update -y

echo "==> Installing Docker Engine + Compose plugin, git, certbot, ufw, age"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
# age: encrypts backups with a PUBLIC key (backup.sh). curl: health pings.
apt-get install -y docker-compose-plugin git certbot ufw age curl fail2ban unattended-upgrades

echo "==> Automatic security updates"
dpkg-reconfigure -f noninteractive unattended-upgrades

echo "==> fail2ban (SSH brute-force protection)"
systemctl enable --now fail2ban

echo "==> Deploy user '${DEPLOY_USER}' (non-root, in the docker group)"
if ! id "${DEPLOY_USER}" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "${DEPLOY_USER}"
fi
usermod -aG docker "${DEPLOY_USER}"
# Reuse root's SSH keys so you can log in as the deploy user straight away.
if [[ -f /root/.ssh/authorized_keys && ! -f "/home/${DEPLOY_USER}/.ssh/authorized_keys" ]]; then
  install -d -m 700 -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" "/home/${DEPLOY_USER}/.ssh"
  install -m 600 -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" /root/.ssh/authorized_keys "/home/${DEPLOY_USER}/.ssh/authorized_keys"
fi

MEM_MB=$(( $(awk '/^MemTotal:/ { print $2 }' /proc/meminfo) / 1024 ))
if (( MEM_MB < SWAP_IF_RAM_BELOW_MB )) && ! swapon --show | grep -q .; then
  echo "==> Adding ${SWAP_SIZE} swap (RAM is ${MEM_MB} MB)"
  fallocate -l "${SWAP_SIZE}" /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  sysctl -w vm.swappiness=10 >/dev/null
  echo 'vm.swappiness=10' > /etc/sysctl.d/99-nari-swap.conf
fi

echo "==> Firewall (SSH, HTTP, HTTPS, TURN)"
ufw allow OpenSSH || true
ufw allow 80/tcp || true
ufw allow 443/tcp || true
# TURN (coturn, host networking): signalling port + UDP relay range.
ufw allow 3478/tcp || true
ufw allow 3478/udp || true
ufw allow "${TURN_RELAY_MIN}:${TURN_RELAY_MAX}/udp" || true
ufw --force enable || true

echo "==> App directory ${APP_DIR} (owned by ${DEPLOY_USER}; clone the repo into it)"
mkdir -p "${APP_DIR}"
chown -R "${DEPLOY_USER}:${DEPLOY_USER}" "${APP_DIR}"
# Data directories (evidence uploads, ACME webroot, backups) are created by
# deploy.sh inside the clone, so the directory stays empty for `git clone`.

echo ""
echo "Bootstrap complete. Continue as the deploy user (guide: deploy/production/VPS_DEPLOYMENT.md):"
echo "  su - ${DEPLOY_USER}"
echo "  git clone <your-repo-url> ${APP_DIR}        # the directory exists and is yours"
echo "  cd ${APP_DIR}"
echo "  bash deploy/production/scripts/init-env.sh <your-domain>"
echo "  exit   # back to root for the one-time certificate step:"
echo "  sudo bash ${APP_DIR}/deploy/production/scripts/issue-certs.sh <your-domain> <your-email>"
echo "  su - ${DEPLOY_USER} -c 'cd ${APP_DIR} && bash deploy/production/scripts/deploy.sh'"
