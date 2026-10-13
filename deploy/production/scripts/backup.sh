#!/usr/bin/env bash
# ============================================================
# Nari Surokkha — encrypted, off-site daily backup.
#
#   1. pg_dump (custom format) of the production database
#   2. sanity check: pg_restore --list must parse the dump
#   3. evidence uploads archive (only when STORAGE_PROVIDER=local)
#   4. encrypt with age (BACKUP_AGE_RECIPIENT) or GPG (BACKUP_GPG_RECIPIENT)
#      — only the PUBLIC key is on this server; plaintext never leaves it
#   5. upload to an S3-compatible bucket (R2, B2, S3, Wasabi, MinIO) with
#      the aws CLI (host binary, or the amazon/aws-cli container) or rclone
#   6. retention: daily copies for BACKUP_RETENTION_DAYS, plus the first
#      backup of each month for BACKUP_MONTHLY_RETENTION_MONTHS
#
# Schedule: deploy/production/systemd/nari-backup.{service,timer}
# or cron:  15 2 * * * /opt/nari-surokkha/deploy/production/scripts/backup.sh >> /var/log/nari-backup.log 2>&1
#
# Exit codes (non-zero = alert someone):
#   0 ok · 2 configuration · 3 dump/verify · 4 encryption · 5 upload · 6 retention
#
# Docs: docs/operations/backup-and-restore.md
# ============================================================
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/nari-surokkha}"
ENV_FILE="${ENV_FILE:-${APP_DIR}/.env.production}"
cd "${APP_DIR}"

log()  { printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
STAGE="startup"
fail() { # code, message
  log "FAILED (${STAGE}): $2"
  if [ -n "${BACKUP_HEALTHCHECK_URL:-}" ]; then
    curl -fsS -m 10 --retry 3 -o /dev/null "${BACKUP_HEALTHCHECK_URL%/}/fail" || true
  fi
  exit "$1"
}
trap 'fail 1 "unexpected error on line ${LINENO}"' ERR

[ -f "${ENV_FILE}" ] || fail 2 "env file not found: ${ENV_FILE}"

# Read only the keys this script needs. The env file is in docker-compose
# format, not shell: sourcing it would execute values such as
# `...?pgbouncer=true&connection_limit=10` (the `&` backgrounds a command).
load_env() { # file
  local line key val
  while IFS= read -r line || [ -n "${line}" ]; do
    [[ "${line}" =~ ^[[:space:]]*(POSTGRES_[A-Z_]+|UPLOADS_DIR|STORAGE_PROVIDER|BACKUP_[A-Z0-9_]+|AWS_CLI_IMAGE)=(.*)$ ]] || continue
    key="${BASH_REMATCH[1]}"; val="${BASH_REMATCH[2]}"
    if [[ "${val}" =~ ^\"(.*)\"[[:space:]]*(#.*)?$ ]] || [[ "${val}" =~ ^\'(.*)\'[[:space:]]*(#.*)?$ ]]; then
      val="${BASH_REMATCH[1]}"
    else
      val="${val%%[[:space:]]#*}"                       # inline comment
      val="${val%"${val##*[![:space:]]}"}"              # trailing spaces
    fi
    printf -v "${key}" '%s' "${val}"
    export "${key?}"
  done < "$1"
}
load_env "${ENV_FILE}"

COMPOSE="${COMPOSE:-docker compose -f ${APP_DIR}/docker-compose.prod.yml --env-file ${ENV_FILE}}"
PG_SERVICE="${PG_SERVICE:-postgres}"
POSTGRES_USER="${POSTGRES_USER:-nari_user}"
POSTGRES_DB="${POSTGRES_DB:-nari_surokkha}"
UPLOADS_DIR="${UPLOADS_DIR:-${APP_DIR}/data/uploads}"
WORK_DIR="${BACKUP_WORK_DIR:-${APP_DIR}/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
MONTHLY_MONTHS="${BACKUP_MONTHLY_RETENTION_MONTHS:-12}"
LOCAL_RETENTION_DAYS="${BACKUP_LOCAL_RETENTION_DAYS:-3}"
UPLOADER="${BACKUP_UPLOADER:-aws}"            # aws | rclone
AWS_CLI_IMAGE="${AWS_CLI_IMAGE:-amazon/aws-cli:2.17.0}"

# ─── Configuration checks ───────────────────────────────────
STAGE="config"
if [ -n "${BACKUP_AGE_RECIPIENT:-}" ]; then
  command -v age >/dev/null || fail 2 "BACKUP_AGE_RECIPIENT is set but 'age' is not installed (apt install age)"
  ENC_EXT="age"
elif [ -n "${BACKUP_GPG_RECIPIENT:-}" ]; then
  command -v gpg >/dev/null || fail 2 "BACKUP_GPG_RECIPIENT is set but 'gpg' is not installed"
  ENC_EXT="gpg"
else
  fail 2 "set BACKUP_AGE_RECIPIENT (age public key) or BACKUP_GPG_RECIPIENT — refusing to upload unencrypted backups"
fi

case "${UPLOADER}" in
  aws)
    [ -n "${BACKUP_S3_URI:-}" ] || fail 2 "BACKUP_S3_URI is required (e.g. s3://nari-backups/production)"
    case "${BACKUP_S3_URI}" in s3://*) ;; *) fail 2 "BACKUP_S3_URI must start with s3://";; esac
    [ -n "${BACKUP_AWS_ACCESS_KEY_ID:-}" ] && [ -n "${BACKUP_AWS_SECRET_ACCESS_KEY:-}" ] \
      || fail 2 "BACKUP_AWS_ACCESS_KEY_ID / BACKUP_AWS_SECRET_ACCESS_KEY are required"
    ;;
  rclone)
    command -v rclone >/dev/null || fail 2 "BACKUP_UPLOADER=rclone but rclone is not installed"
    [ -n "${BACKUP_RCLONE_REMOTE:-}" ] || fail 2 "BACKUP_RCLONE_REMOTE is required (e.g. r2:nari-backups/production)"
    ;;
  *) fail 2 "BACKUP_UPLOADER must be 'aws' or 'rclone'";;
esac

# aws CLI wrapper: host binary if present, else the official container.
# Credentials are passed only via the environment, never on the command line.
aws_s3() {
  local endpoint=()
  [ -n "${BACKUP_S3_ENDPOINT:-}" ] && endpoint=(--endpoint-url "${BACKUP_S3_ENDPOINT}")
  if command -v aws >/dev/null; then
    AWS_ACCESS_KEY_ID="${BACKUP_AWS_ACCESS_KEY_ID}" \
    AWS_SECRET_ACCESS_KEY="${BACKUP_AWS_SECRET_ACCESS_KEY}" \
    AWS_DEFAULT_REGION="${BACKUP_S3_REGION:-auto}" \
      aws "${endpoint[@]}" s3 "$@"
  else
    docker run --rm -i \
      -e AWS_ACCESS_KEY_ID="${BACKUP_AWS_ACCESS_KEY_ID}" \
      -e AWS_SECRET_ACCESS_KEY="${BACKUP_AWS_SECRET_ACCESS_KEY}" \
      -e AWS_DEFAULT_REGION="${BACKUP_S3_REGION:-auto}" \
      -v "${WORK_DIR}:${WORK_DIR}" \
      "${AWS_CLI_IMAGE}" "${endpoint[@]}" s3 "$@"
  fi
}

upload() { # local-file remote-relative-key
  case "${UPLOADER}" in
    aws)    aws_s3 cp --only-show-errors "$1" "${BACKUP_S3_URI%/}/$2" ;;
    rclone) rclone copyto --s3-no-check-bucket "$1" "${BACKUP_RCLONE_REMOTE%/}/$2" ;;
  esac
}

encrypt() { # in out
  case "${ENC_EXT}" in
    age) age -r "${BACKUP_AGE_RECIPIENT}" -o "$2" "$1" ;;
    gpg) gpg --batch --yes --trust-model always -r "${BACKUP_GPG_RECIPIENT}" -o "$2" --encrypt "$1" ;;
  esac
}

# ─── Work area (0700; plaintext lives here only briefly) ────
umask 077
mkdir -p "${WORK_DIR}"
chmod 700 "${WORK_DIR}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DAY_PATH="$(date -u +%Y/%m/%d)"
TMP_DIR="$(mktemp -d "${WORK_DIR}/.tmp-${STAMP}-XXXX")"
# shellcheck disable=SC2329  # invoked via trap
cleanup() { rm -rf "${TMP_DIR}"; }
trap cleanup EXIT

# ─── 1–2. Database dump + verification ──────────────────────
STAGE="dump"
DUMP="${TMP_DIR}/db-${STAMP}.dump"
log "Dumping ${POSTGRES_DB}…"
$COMPOSE exec -T "${PG_SERVICE}" pg_dump -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" \
  --format=custom --compress=6 --no-owner > "${DUMP}" \
  || fail 3 "pg_dump failed"
[ -s "${DUMP}" ] || fail 3 "dump is empty"

STAGE="verify"
TOC_ENTRIES="$($COMPOSE exec -T "${PG_SERVICE}" pg_restore --list < "${DUMP}" | grep -c ' TABLE DATA ' || true)"
[ "${TOC_ENTRIES:-0}" -ge 10 ] || fail 3 "dump looks incomplete: only ${TOC_ENTRIES:-0} TABLE DATA entries"
log "Dump OK: $(du -h "${DUMP}" | cut -f1), ${TOC_ENTRIES} tables with data"

ARTIFACTS=("${DUMP}")

# ─── 3. Evidence uploads (local storage only) ───────────────
STAGE="uploads"
if [ "${STORAGE_PROVIDER:-local}" = "local" ] && [ -d "${UPLOADS_DIR}" ]; then
  UP_TAR="${TMP_DIR}/uploads-${STAMP}.tar.gz"
  log "Archiving evidence uploads from ${UPLOADS_DIR}…"
  tar -czf "${UP_TAR}" -C "$(dirname "${UPLOADS_DIR}")" "$(basename "${UPLOADS_DIR}")" \
    || fail 3 "tar of uploads failed"
  ARTIFACTS+=("${UP_TAR}")
else
  log "Evidence is in object storage (${STORAGE_PROVIDER:-?}); enable bucket versioning/replication there instead."
fi

# ─── 4–5. Encrypt + upload ──────────────────────────────────
for f in "${ARTIFACTS[@]}"; do
  STAGE="encrypt"
  enc="${f}.${ENC_EXT}"
  encrypt "${f}" "${enc}" || fail 4 "encryption failed for $(basename "${f}")"
  rm -f "${f}"
  [ -s "${enc}" ] || fail 4 "encrypted file is empty: $(basename "${enc}")"

  STAGE="upload"
  key="${DAY_PATH}/$(basename "${enc}")"
  log "Uploading ${key} ($(du -h "${enc}" | cut -f1))…"
  upload "${enc}" "${key}" || fail 5 "upload failed for ${key}"

  # Keep a short local copy (encrypted) for fast restores.
  mkdir -p "${WORK_DIR}/local"
  mv "${enc}" "${WORK_DIR}/local/"
done

# ─── 6. Retention ───────────────────────────────────────────
STAGE="retention"
find "${WORK_DIR}/local" -type f -mtime +"${LOCAL_RETENTION_DAYS}" -delete || fail 6 "local prune failed"

if [ "${UPLOADER}" = "aws" ]; then
  # Keys look like YYYY/MM/DD/<file>. Keep: anything newer than the daily
  # window, and anything from day 01 newer than the monthly window.
  # (A bucket lifecycle rule is a fine alternative — then set
  #  BACKUP_REMOTE_PRUNE=false.)
  if [ "${BACKUP_REMOTE_PRUNE:-true}" = "true" ]; then
    daily_cutoff="$(date -u -d "-${RETENTION_DAYS} days" +%Y%m%d)"
    monthly_cutoff="$(date -u -d "-${MONTHLY_MONTHS} months" +%Y%m%d)"
    # s3://bucket/a/b -> "a/b";  s3://bucket -> "" (bucket root)
    prefix_path="${BACKUP_S3_URI#s3://*/}"
    [ "${prefix_path}" = "${BACKUP_S3_URI}" ] && prefix_path=""
    listing="$(aws_s3 ls --recursive "${BACKUP_S3_URI%/}/")" || fail 6 "could not list ${BACKUP_S3_URI}"
    pruned=0
    while read -r _d _t _s key; do
      [ -n "${key:-}" ] || continue
      rel="${key#"${prefix_path:+${prefix_path%/}/}"}"
      if [[ "${rel}" =~ ^([0-9]{4})/([0-9]{2})/([0-9]{2})/ ]]; then
        ymd="${BASH_REMATCH[1]}${BASH_REMATCH[2]}${BASH_REMATCH[3]}"
        dd="${BASH_REMATCH[3]}"
        if [ "${ymd}" -lt "${daily_cutoff}" ]; then
          if [ "${dd}" = "01" ] && [ "${ymd}" -ge "${monthly_cutoff}" ]; then continue; fi
          aws_s3 rm --only-show-errors "${BACKUP_S3_URI%/}/${rel}" || fail 6 "could not delete ${rel}"
          pruned=$((pruned + 1))
        fi
      fi
    done <<< "${listing}"
    log "Remote retention: pruned ${pruned} object(s)"
  fi
else
  log "rclone: configure retention with a bucket lifecycle rule (see docs)."
fi

trap - ERR
log "Backup complete."
if [ -n "${BACKUP_HEALTHCHECK_URL:-}" ]; then
  curl -fsS -m 10 --retry 3 -o /dev/null "${BACKUP_HEALTHCHECK_URL}" || log "warning: healthcheck ping failed"
fi
exit 0
