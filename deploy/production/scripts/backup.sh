#!/usr/bin/env bash
# ============================================================
# Daily backup: PostgreSQL dump + evidence uploads.
# Cron example (2 AM daily):
#   0 2 * * * cd /opt/nari-surokkha && bash deploy/production/scripts/backup.sh >> backups/backup.log 2>&1
# ============================================================
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/nari-surokkha}"
cd "${APP_DIR}"

BACKUP_DIR="${APP_DIR}/backups"
UPLOADS_DIR="${UPLOADS_DIR:-${APP_DIR}/data/uploads}"
STAMP="$(date +%Y%m%d-%H%M%S)"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
COMPOSE="docker compose -f docker-compose.prod.yml --env-file .env.production"

mkdir -p "${BACKUP_DIR}"

# shellcheck disable=SC1091
set -a; . ./.env.production; set +a

echo "[$(date)] Dumping database…"
$COMPOSE exec -T postgres pg_dump -U "${POSTGRES_USER}" "${POSTGRES_DB}" \
  | gzip > "${BACKUP_DIR}/db-${STAMP}.sql.gz"

echo "[$(date)] Archiving evidence uploads…"
tar -czf "${BACKUP_DIR}/uploads-${STAMP}.tar.gz" -C "$(dirname "${UPLOADS_DIR}")" "$(basename "${UPLOADS_DIR}")"

echo "[$(date)] Pruning backups older than ${RETENTION_DAYS} days…"
find "${BACKUP_DIR}" -name 'db-*.sql.gz' -mtime +"${RETENTION_DAYS}" -delete
find "${BACKUP_DIR}" -name 'uploads-*.tar.gz' -mtime +"${RETENTION_DAYS}" -delete

echo "[$(date)] Backup complete: ${BACKUP_DIR}"
