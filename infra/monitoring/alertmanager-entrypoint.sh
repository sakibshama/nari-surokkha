#!/bin/sh
# Alertmanager entrypoint wrapper (mounted by docker-compose.prod.yml).
#
# Alertmanager cannot read environment variables from its config file, so
# this writes ALERT_WEBHOOK_URL to a file that the slack_configs receivers
# reference with `api_url_file`, then execs Alertmanager. It refuses to start
# without a URL: a monitoring stack that silently delivers nothing is worse
# than one that visibly fails to start.
set -eu

URL_FILE=/alertmanager/.webhook_url

if [ -z "${ALERT_WEBHOOK_URL:-}" ]; then
  echo "alertmanager-entrypoint: ALERT_WEBHOOK_URL is empty; set it in .env.production" >&2
  echo "  (Slack incoming webhook, or a Discord webhook URL ending in /slack)" >&2
  exit 1
fi

umask 077
printf '%s' "$ALERT_WEBHOOK_URL" > "$URL_FILE"

exec /bin/alertmanager \
  --config.file=/etc/alertmanager/alertmanager.yml \
  --storage.path=/alertmanager \
  "$@"
