@echo off
rem One-time OSRM map data extraction script for Windows environments
echo [osrm-setup] Creating data directory ./data/osrm...
if not exist "data\osrm" mkdir "data\osrm"

cd data\osrm

if not exist "map.osm.pbf" (
    echo [osrm-setup] Downloading Bangladesh OSM extract...
    powershell -Command "Invoke-WebRequest -Uri 'https://download.geofabrik.de/asia/bangladesh-latest.osm.pbf' -OutFile 'map.osm.pbf'"
) else (
    echo [osrm-setup] Reusing existing map.osm.pbf
)

echo [osrm-setup] Extracting foot walking routing profile via Docker...
docker run --rm -v "%cd%:/data" osrm/osrm-backend:v5.27.1 osrm-extract -p /opt/foot.lua /data/map.osm.pbf

echo [osrm-setup] Partitioning OSRM map...
docker run --rm -v "%cd%:/data" osrm/osrm-backend:v5.27.1 osrm-partition /data/map.osrm

echo [osrm-setup] Customizing OSRM map...
docker run --rm -v "%cd%:/data" osrm/osrm-backend:v5.27.1 osrm-customize /data/map.osrm

cd ..\..
echo [osrm-setup] Done! Start the self-hosted router with: docker compose up -d osrm
