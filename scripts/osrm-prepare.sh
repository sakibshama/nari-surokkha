#!/usr/bin/env bash
#
# One-time OSRM data build for the Safe Route engine (foot/walking profile).
#
# Downloads the Bangladesh OpenStreetMap extract and runs the OSRM MLD
# pipeline (extract → partition → customize) into ./data/osrm. After this,
# start the router with:
#
#   docker compose -f docker-compose.prod.yml --profile osrm up -d osrm
#
# Re-run this script to refresh the map (e.g. monthly). It needs Docker and a
# few GB of free disk. Override the region by setting PBF_URL.
#
set -euo pipefail

OSRM_IMAGE="osrm/osrm-backend:v5.27.1"
DATA_DIR="${OSRM_DIR:-./data/osrm}"
PBF_URL="${PBF_URL:-https://download.geofabrik.de/asia/bangladesh-latest.osm.pbf}"
PBF_FILE="map.osm.pbf"
PROFILE="foot" # walking directions

mkdir -p "$DATA_DIR"
cd "$DATA_DIR"

if [ ! -f "$PBF_FILE" ]; then
  echo "[osrm-prepare] downloading $PBF_URL"
  curl -L --fail -o "$PBF_FILE" "$PBF_URL"
else
  echo "[osrm-prepare] reusing existing $PBF_FILE (delete it to re-download)"
fi

run() { docker run --rm -t -v "${PWD}:/data" "$OSRM_IMAGE" "$@"; }

echo "[osrm-prepare] extract ($PROFILE profile)…"
run osrm-extract -p "/opt/${PROFILE}.lua" "/data/${PBF_FILE}"

echo "[osrm-prepare] partition…"
run osrm-partition /data/map.osrm

echo "[osrm-prepare] customize…"
run osrm-customize /data/map.osrm

echo "[osrm-prepare] done. Built map.osrm in ${DATA_DIR}."
echo "Start it:  docker compose -f docker-compose.prod.yml --profile osrm up -d osrm"
