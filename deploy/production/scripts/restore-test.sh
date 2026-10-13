#!/usr/bin/env bash
#
# Backup restore test.
#
# A backup you have never restored is a hypothesis, not a backup. This script
# restores an encrypted dump made by backup.sh into a THROWAWAY PostGIS
# container, verifies the things that actually matter, prints pass/fail and
# removes the container. It never touches the live database.
#
# Run it where the PRIVATE key is (an admin machine or a separate restore
# host with Docker) — not on the production server, which only holds the
# public key.
#
#   restore-test.sh                       # newest backup in the bucket
#   restore-test.sh path/to/db-*.dump.age # a specific local file
#   restore-test.sh path/to/db-*.dump     # an unencrypted dump
#
# Environment (same names as backup.sh / .env.production):
#   BACKUP_AGE_IDENTITY_FILE  age private key file   (for *.age)
#   (GPG: the private key must be in the local keyring, for *.gpg)
#   BACKUP_S3_URI, BACKUP_S3_ENDPOINT, BACKUP_S3_REGION,
#   BACKUP_AWS_ACCESS_KEY_ID, BACKUP_AWS_SECRET_ACCESS_KEY  (remote download)
#   RPO_HOURS (default 26)   PG_IMAGE (default postgis/postgis:16-3.4-alpine)
#   ENV_FILE  optional file to source for the variables above
#
# Exit codes: 0 pass · 1 checks failed · 2 configuration · 3 download/decrypt
#             · 4 restore · 5 backup too old (RPO)
#
# Schedule monthly (deploy/production/systemd/nari-restore-test.timer) and
# alert on non-zero exit.
set -Eeuo pipefail

# Read only the keys this script needs (the file may be a docker-compose env
# file such as .env.production, which is not safe to `source`).
load_env() { # file
  local line key val
  while IFS= read -r line || [ -n "${line}" ]; do
    [[ "${line}" =~ ^[[:space:]]*(BACKUP_[A-Z0-9_]+|RPO_HOURS|PG_IMAGE|AWS_CLI_IMAGE)=(.*)$ ]] || continue
    key="${BASH_REMATCH[1]}"; val="${BASH_REMATCH[2]}"
    if [[ "${val}" =~ ^\"(.*)\"[[:space:]]*(#.*)?$ ]] || [[ "${val}" =~ ^\'(.*)\'[[:space:]]*(#.*)?$ ]]; then
      val="${BASH_REMATCH[1]}"
    else
      val="${val%%[[:space:]]#*}"
      val="${val%"${val##*[![:space:]]}"}"
    fi
    printf -v "${key}" '%s' "${val}"
    export "${key?}"
  done < "$1"
}
if [ -n "${ENV_FILE:-}" ]; then
  [ -f "${ENV_FILE}" ] || { printf 'FAIL: ENV_FILE not found: %s\n' "${ENV_FILE}"; exit 2; }
  load_env "${ENV_FILE}"
fi

PG_IMAGE="${PG_IMAGE:-postgis/postgis:16-3.4-alpine}"
RPO_HOURS="${RPO_HOURS:-26}"
AWS_CLI_IMAGE="${AWS_CLI_IMAGE:-amazon/aws-cli:2.17.0}"
WORK="$(mktemp -d)"
CONTAINER="nari-restore-test-$$"

red()   { printf '\033[31m%s\033[0m\n' "$1"; }
green() { printf '\033[32m%s\033[0m\n' "$1"; }
die()   { red "FAIL: $2"; exit "$1"; }

# shellcheck disable=SC2329  # invoked via trap
cleanup() {
  docker rm -f "${CONTAINER}" >/dev/null 2>&1 || true
  rm -rf "${WORK}"
}
trap cleanup EXIT

command -v docker >/dev/null || die 2 "docker is required"

aws_s3() {
  local endpoint=()
  [ -n "${BACKUP_S3_ENDPOINT:-}" ] && endpoint=(--endpoint-url "${BACKUP_S3_ENDPOINT}")
  if command -v aws >/dev/null; then
    AWS_ACCESS_KEY_ID="${BACKUP_AWS_ACCESS_KEY_ID}" AWS_SECRET_ACCESS_KEY="${BACKUP_AWS_SECRET_ACCESS_KEY}" \
    AWS_DEFAULT_REGION="${BACKUP_S3_REGION:-auto}" aws "${endpoint[@]}" s3 "$@"
  else
    docker run --rm -i -e AWS_ACCESS_KEY_ID="${BACKUP_AWS_ACCESS_KEY_ID}" \
      -e AWS_SECRET_ACCESS_KEY="${BACKUP_AWS_SECRET_ACCESS_KEY}" \
      -e AWS_DEFAULT_REGION="${BACKUP_S3_REGION:-auto}" \
      -v "${WORK}:${WORK}" "${AWS_CLI_IMAGE}" "${endpoint[@]}" s3 "$@"
  fi
}

# ─── 1. Locate the backup ───────────────────────────────────
BACKUP_FILE="${1:-}"
if [ -z "${BACKUP_FILE}" ]; then
  [ -n "${BACKUP_S3_URI:-}" ] || die 2 "no file given and BACKUP_S3_URI is not set"
  echo "→ Finding the newest database backup in ${BACKUP_S3_URI}"
  NEWEST="$(aws_s3 ls --recursive "${BACKUP_S3_URI%/}/" | awk '$4 ~ /\/db-[^\/]+\.dump\.(age|gpg)$/ {print $1" "$2" "$4}' | sort | tail -1)" \
    || die 3 "could not list the bucket"
  [ -n "${NEWEST}" ] || die 3 "no db-*.dump.(age|gpg) objects found — that is the finding: there is nothing to restore"
  KEY="$(awk '{print $3}' <<< "${NEWEST}")"
  BUCKET="${BACKUP_S3_URI#s3://}"; BUCKET="${BUCKET%%/*}"
  BACKUP_FILE="${WORK}/$(basename "${KEY}")"
  aws_s3 cp --only-show-errors "s3://${BUCKET}/${KEY}" "${BACKUP_FILE}" || die 3 "download failed: ${KEY}"
else
  [ -f "${BACKUP_FILE}" ] || die 2 "file not found: ${BACKUP_FILE}"
fi

# Backup age from the UTC timestamp backup.sh puts in the name
# (db-YYYYMMDDTHHMMSSZ.dump…); fall back to the file's mtime.
if [[ "$(basename "${BACKUP_FILE}")" =~ ([0-9]{8})T([0-9]{2})([0-9]{2})([0-9]{2})Z ]]; then
  d="${BASH_REMATCH[1]}"
  OBJ_EPOCH="$(date -u -d "${d:0:4}-${d:4:2}-${d:6:2} ${BASH_REMATCH[2]}:${BASH_REMATCH[3]}:${BASH_REMATCH[4]}" +%s)"
else
  OBJ_EPOCH="$(stat -c %Y "${BACKUP_FILE}")"
fi

AGE_HOURS=$(( ( $(date +%s) - OBJ_EPOCH ) / 3600 ))
echo "Backup:  ${BACKUP_FILE}"
echo "Age:     ${AGE_HOURS}h (RPO ${RPO_HOURS}h)"
echo "Size:    $(du -h "${BACKUP_FILE}" | cut -f1)"

# ─── 2. Decrypt ─────────────────────────────────────────────
DUMP="${WORK}/restore.dump"
case "${BACKUP_FILE}" in
  *.age)
    [ -n "${BACKUP_AGE_IDENTITY_FILE:-}" ] && [ -f "${BACKUP_AGE_IDENTITY_FILE}" ] \
      || die 2 "BACKUP_AGE_IDENTITY_FILE (age private key) is required for .age backups"
    age -d -i "${BACKUP_AGE_IDENTITY_FILE}" -o "${DUMP}" "${BACKUP_FILE}" || die 3 "age decryption failed" ;;
  *.gpg)
    gpg --batch --yes -o "${DUMP}" --decrypt "${BACKUP_FILE}" || die 3 "gpg decryption failed" ;;
  *.dump)
    cp "${BACKUP_FILE}" "${DUMP}" ;;
  *) die 2 "unrecognised backup format: ${BACKUP_FILE}" ;;
esac

# ─── 3. Throwaway PostGIS + restore ─────────────────────────
echo "→ Starting scratch ${PG_IMAGE}"
docker run -d --name "${CONTAINER}" -e POSTGRES_PASSWORD=restore -e POSTGRES_DB=restore_test \
  "${PG_IMAGE}" >/dev/null || die 4 "could not start ${PG_IMAGE}"
for _ in $(seq 1 60); do
  # Wait for the real server (the image restarts once after initdb).
  if docker exec "${CONTAINER}" pg_isready -U postgres -d restore_test -h 127.0.0.1 >/dev/null 2>&1; then break; fi
  sleep 2
done
docker exec "${CONTAINER}" pg_isready -U postgres -d restore_test -h 127.0.0.1 >/dev/null || die 4 "scratch Postgres did not become ready"

# Restore into a database cloned from template0: the image pre-creates PostGIS
# (and tiger/topology) in POSTGRES_DB, and the dump must recreate its own.
docker exec "${CONTAINER}" createdb -U postgres -T template0 restore_target || die 4 "createdb failed"

START=$(date +%s)
echo "→ Restoring"
docker exec -i "${CONTAINER}" pg_restore -U postgres -d restore_target --no-owner --no-acl --exit-on-error \
  < "${DUMP}" > "${WORK}/restore.log" 2>&1 || { tail -20 "${WORK}/restore.log"; die 4 "pg_restore failed"; }
RESTORE_SECONDS=$(( $(date +%s) - START ))
echo "→ Restored in ${RESTORE_SECONDS}s"
echo

q() { docker exec "${CONTAINER}" psql -U postgres -d restore_target -tAc "$1" 2>/dev/null | tr -d '[:space:]'; }

FAILED=0
check() { # name, actual, expectation, pass(1/0)
  if [ "$4" = "1" ]; then green "PASS  $1 ($2)"; else red "FAIL  $1 ($2) — expected $3"; FAILED=1; fi
}

echo "Verifying the restore is actually usable:"

HAS_POSTGIS=$(q "SELECT count(*) FROM pg_extension WHERE extname='postgis';")
check "PostGIS extension" "$HAS_POSTGIS" ">0" "$([ "${HAS_POSTGIS:-0}" -gt 0 ] && echo 1 || echo 0)"

TABLES=$(q "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';")
check "public tables" "$TABLES" ">=20" "$([ "${TABLES:-0}" -ge 20 ] && echo 1 || echo 0)"

# Geometry columns survived: losing them silently turns every spatial query
# into a sequential scan.
GEOM=$(q "SELECT count(*) FROM information_schema.columns WHERE udt_name='geometry';")
check "geometry columns" "$GEOM" ">=6" "$([ "${GEOM:-0}" -ge 6 ] && echo 1 || echo 0)"

GIST=$(q "SELECT count(*) FROM pg_indexes WHERE indexdef ILIKE '%USING gist%';")
check "GIST indexes" "$GIST" ">=6" "$([ "${GIST:-0}" -ge 6 ] && echo 1 || echo 0)"

TRIGGERS=$(q "SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'trg_sync%';")
check "location sync triggers" "$TRIGGERS" ">=4" "$([ "${TRIGGERS:-0}" -ge 4 ] && echo 1 || echo 0)"

USERS=$(q "SELECT count(*) FROM users;")
check "user rows" "$USERS" ">0" "$([ "${USERS:-0}" -gt 0 ] && echo 1 || echo 0)"

SPATIAL_OK=$(q "SELECT CASE WHEN count(*) >= 0 THEN 1 ELSE 0 END FROM responders WHERE location IS NOT NULL;")
check "spatial query executes" "${SPATIAL_OK:-0}" "1" "$([ "${SPATIAL_OK:-0}" = "1" ] && echo 1 || echo 0)"

MIGRATIONS=$(q "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL;")
check "applied migrations" "$MIGRATIONS" ">=8" "$([ "${MIGRATIONS:-0}" -ge 8 ] && echo 1 || echo 0)"

echo
echo "Restore time (RTO contribution): ${RESTORE_SECONDS}s"
if [ "$FAILED" -ne 0 ]; then
  red "RESTORE TEST FAILED — do not rely on this backup"
  exit 1
fi
if [ "${AGE_HOURS}" -gt "${RPO_HOURS}" ]; then
  red "Backup restores, but it is ${AGE_HOURS}h old — the ${RPO_HOURS}h RPO is not being met (is the backup timer running?)"
  exit 5
fi
green "RESTORE TEST PASSED — this backup is known-good as of $(date -Is)"
exit 0
