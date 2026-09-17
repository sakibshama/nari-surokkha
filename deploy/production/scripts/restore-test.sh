#!/usr/bin/env bash
#
# Backup restore test.
#
# A backup you have never restored is a hypothesis, not a backup. This script
# turns that hypothesis into a fact: it restores the most recent dump into a
# THROWAWAY database, verifies the things that actually matter, and prints a
# pass/fail.
#
# It never touches the live database. The restore target is a scratch database
# whose name is generated per run and dropped at the end.
#
#   ./deploy/production/scripts/restore-test.sh                 # newest backup
#   ./deploy/production/scripts/restore-test.sh /path/to.dump   # a specific one
#
# Run it monthly. Wire it into cron and have it alert on non-zero exit.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/opt/nari-surokkha/backups}"
COMPOSE="${COMPOSE:-docker compose -f docker-compose.prod.yml --env-file .env.production}"
PG_SERVICE="${PG_SERVICE:-postgres}"
PG_USER="${POSTGRES_USER:-nari_user}"
SCRATCH_DB="restore_test_$(date +%Y%m%d_%H%M%S)"

red()   { printf '\033[31m%s\033[0m\n' "$1"; }
green() { printf '\033[32m%s\033[0m\n' "$1"; }
info()  { printf '  %s\n' "$1"; }

BACKUP_FILE="${1:-}"
if [ -z "$BACKUP_FILE" ]; then
  BACKUP_FILE=$(ls -t "$BACKUP_DIR"/*.dump "$BACKUP_DIR"/*.sql.gz 2>/dev/null | head -1 || true)
fi

if [ -z "$BACKUP_FILE" ] || [ ! -f "$BACKUP_FILE" ]; then
  red "FAIL: no backup found in $BACKUP_DIR"
  red "      That is the finding. There is nothing to restore."
  exit 1
fi

AGE_HOURS=$(( ( $(date +%s) - $(stat -c %Y "$BACKUP_FILE") ) / 3600 ))
echo "Backup:  $BACKUP_FILE"
echo "Age:     ${AGE_HOURS}h"
echo "Size:    $(du -h "$BACKUP_FILE" | cut -f1)"
echo "Target:  $SCRATCH_DB (scratch, dropped at the end)"
echo

# RPO check — a backup older than 24h means the stated objective is not met.
RPO_HOURS="${RPO_HOURS:-24}"
if [ "$AGE_HOURS" -gt "$RPO_HOURS" ]; then
  red "FAIL: newest backup is ${AGE_HOURS}h old, exceeding the ${RPO_HOURS}h RPO."
  exit 1
fi

cleanup() {
  $COMPOSE exec -T "$PG_SERVICE" psql -U "$PG_USER" -d postgres \
    -c "DROP DATABASE IF EXISTS $SCRATCH_DB;" >/dev/null 2>&1 || true
}
trap cleanup EXIT

START=$(date +%s)

echo "→ Creating scratch database"
$COMPOSE exec -T "$PG_SERVICE" psql -U "$PG_USER" -d postgres -c "CREATE DATABASE $SCRATCH_DB;" >/dev/null

echo "→ Restoring"
case "$BACKUP_FILE" in
  *.gz)   gunzip -c "$BACKUP_FILE" | $COMPOSE exec -T "$PG_SERVICE" psql -U "$PG_USER" -d "$SCRATCH_DB" >/dev/null 2>&1 ;;
  *.dump) $COMPOSE exec -T "$PG_SERVICE" pg_restore -U "$PG_USER" -d "$SCRATCH_DB" --no-owner < "$BACKUP_FILE" >/dev/null 2>&1 ;;
  *)      red "FAIL: unrecognised backup format: $BACKUP_FILE"; exit 1 ;;
esac

RESTORE_SECONDS=$(( $(date +%s) - START ))
echo "→ Restored in ${RESTORE_SECONDS}s"
echo

q() { $COMPOSE exec -T "$PG_SERVICE" psql -U "$PG_USER" -d "$SCRATCH_DB" -tAc "$1" 2>/dev/null | tr -d '[:space:]'; }

FAILED=0
check() { # name, actual, predicate-description, test-expression
  if [ "$4" = "1" ]; then green "PASS  $1 ($2)"; else red "FAIL  $1 ($2) — expected $3"; FAILED=1; fi
}

echo "Verifying the restore is actually usable:"

# 1. PostGIS present — without it, half the schema is meaningless.
HAS_POSTGIS=$(q "SELECT count(*) FROM pg_extension WHERE extname='postgis';")
check "PostGIS extension" "$HAS_POSTGIS" ">0" "$([ "${HAS_POSTGIS:-0}" -gt 0 ] && echo 1 || echo 0)"

# 2. Core tables restored.
TABLES=$(q "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';")
check "public tables" "$TABLES" ">=20" "$([ "${TABLES:-0}" -ge 20 ] && echo 1 || echo 0)"

# 3. THE critical one: geometry columns survived. A dump/restore that loses
#    these leaves every spatial query doing a sequential scan, silently.
GEOM=$(q "SELECT count(*) FROM information_schema.columns WHERE udt_name='geometry';")
check "geometry columns" "$GEOM" ">=6" "$([ "${GEOM:-0}" -ge 6 ] && echo 1 || echo 0)"

# 4. Spatial indexes present.
GIST=$(q "SELECT count(*) FROM pg_indexes WHERE indexdef ILIKE '%USING gist%';")
check "GIST indexes" "$GIST" ">=6" "$([ "${GIST:-0}" -ge 6 ] && echo 1 || echo 0)"

# 5. The sync triggers that keep location columns current.
TRIGGERS=$(q "SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'trg_sync%';")
check "location sync triggers" "$TRIGGERS" ">=4" "$([ "${TRIGGERS:-0}" -ge 4 ] && echo 1 || echo 0)"

# 6. Data actually came back, not just an empty schema.
USERS=$(q "SELECT count(*) FROM users;")
check "user rows" "$USERS" ">0" "$([ "${USERS:-0}" -gt 0 ] && echo 1 || echo 0)"

# 7. A spatial query runs on the restored data.
SPATIAL_OK=$(q "SELECT CASE WHEN count(*) >= 0 THEN 1 ELSE 0 END FROM responders WHERE location IS NOT NULL;")
check "spatial query executes" "${SPATIAL_OK:-0}" "1" "$([ "${SPATIAL_OK:-0}" = "1" ] && echo 1 || echo 0)"

# 8. Migration history intact, so the app will not try to re-run everything.
MIGRATIONS=$(q "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL;")
check "applied migrations" "$MIGRATIONS" ">=8" "$([ "${MIGRATIONS:-0}" -ge 8 ] && echo 1 || echo 0)"

echo
echo "Restore time (RTO contribution): ${RESTORE_SECONDS}s"
if [ "$FAILED" -eq 0 ]; then
  green "RESTORE TEST PASSED — this backup is known-good as of $(date -Is)"
  exit 0
fi
red "RESTORE TEST FAILED — do not rely on this backup"
exit 1
