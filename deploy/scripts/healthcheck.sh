#!/usr/bin/env bash
# API health check (staging or production).
#
#   deploy/scripts/healthcheck.sh                         # http://localhost/health/ready
#   API_URL=https://api.example.com deploy/scripts/healthcheck.sh
#
# /health/ready checks the database and Redis; /health/live only the process.
# Exit 0 when healthy, 1 otherwise (usable from cron or a deploy script).
set -euo pipefail

API_URL="${API_URL:-http://localhost}"
ENDPOINT="${ENDPOINT:-/health/ready}"
URL="${API_URL%/}${ENDPOINT}"

echo "Checking Nari Surokkha API health at ${URL}..."
STATUS_CODE="$(curl -s -o /dev/null -m 10 -w '%{http_code}' "${URL}" || true)"

if [ "${STATUS_CODE}" = "200" ]; then
  echo "OK: API is healthy (HTTP 200)"
  exit 0
fi
echo "FAIL: API health check failed (HTTP ${STATUS_CODE:-no response})"
exit 1
