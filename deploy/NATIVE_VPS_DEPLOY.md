# Nari Surokkha — Native VPS Deployment (no Docker)

For a VPS that already has **Ubuntu, PostgreSQL, Redis, Git and Node.js**.
The API runs as a systemd service, the two portals are built to static files
served by Nginx, and everything talks to your local Postgres/Redis.

Domain used below: `mystrix-soft.com` → change if different.
Layout: `api.` = API, `admin.` = admin portal, `police.` = police portal.

---

## 0. Prerequisites

```bash
node -v          # must be >= 20
psql --version   # note the major version (e.g. 16)

# Build tools (argon2 compiles natively) + PostGIS + Nginx + TLS
sudo apt update
sudo apt install -y build-essential python3 nginx certbot python3-certbot-nginx
# PostGIS — MATCH your Postgres major version (16 shown):
sudo apt install -y postgresql-16-postgis-3
```

DNS: point three A-records at the VPS IP — `api.mystrix-soft.com`,
`admin.mystrix-soft.com`, `police.mystrix-soft.com`.

---

## 1. Database (run once)

```bash
sudo -u postgres psql <<'SQL'
CREATE DATABASE nari_surokkha;
CREATE USER nari_user WITH ENCRYPTED PASSWORD 'CHANGE_ME_db_password';
GRANT ALL PRIVILEGES ON DATABASE nari_surokkha TO nari_user;
\c nari_surokkha
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
GRANT ALL ON SCHEMA public TO nari_user;
SQL
```

(Creating the extensions here as the `postgres` superuser means the app user
doesn't need superuser. The migration uses `IF NOT EXISTS`, so it's happy.)

Redis: the default `redis://localhost:6379` works. To require a password, set
`requirepass` in `/etc/redis/redis.conf`, restart, and use
`redis://:PASSWORD@localhost:6379` below.

---

## 2. Clone the repo

```bash
sudo mkdir -p /opt/nari-surokkha && sudo chown $USER:$USER /opt/nari-surokkha
git clone <your-repo-url> /opt/nari-surokkha
cd /opt/nari-surokkha
mkdir -p data/uploads
```

---

## 3. API environment

Create `/opt/nari-surokkha/services/api/.env` (the API reads it from this folder):

```bash
cat > /opt/nari-surokkha/services/api/.env <<'ENV'
NODE_ENV=production
PORT=3001
HOST=127.0.0.1
API_BASE_URL=https://api.mystrix-soft.com

DATABASE_URL=postgresql://nari_user:CHANGE_ME_db_password@localhost:5432/nari_surokkha
REDIS_URL=redis://localhost:6379

# openssl rand -hex 48   (each >= 64 chars, must differ)
JWT_SECRET=CHANGE_ME
JWT_REFRESH_SECRET=CHANGE_ME_DIFFERENT
# openssl rand -hex 32
CONFIG_ENCRYPTION_KEY=CHANGE_ME

# Explicit portal origins (wildcards are rejected in production)
CORS_ORIGINS=https://admin.mystrix-soft.com,https://police.mystrix-soft.com
WS_CORS_ORIGINS=https://admin.mystrix-soft.com,https://police.mystrix-soft.com

STORAGE_LOCAL_DIR=/opt/nari-surokkha/data/uploads
LOG_LEVEL=info
LOG_PRETTY=false
ENV
```

`HOST=127.0.0.1` keeps the API private; Nginx is the only public entry point.

---

## 4. Install, build, migrate, seed

```bash
cd /opt/nari-surokkha
npm ci                                        # all workspaces (argon2 builds here)
npm run build --workspace=packages/shared     # API imports its compiled output

cd services/api
npx prisma generate
npx prisma migrate deploy                      # creates schema + PostGIS columns
npm run build                                  # tsc + tsc-alias -> dist/
npm run prisma:seed                            # optional: roles + first admin
```

Quick check: `node dist/server.js` should log "running" with no
`Cannot find module '@/...'` error. Ctrl-C, then set up the service.

---

## 5. Run the API as a systemd service

```bash
sudo tee /etc/systemd/system/nari-api.service >/dev/null <<'UNIT'
[Unit]
Description=Nari Surokkha API
After=network.target postgresql.service redis-server.service

[Service]
Type=simple
WorkingDirectory=/opt/nari-surokkha/services/api
ExecStart=/usr/bin/node dist/server.js
Restart=always
RestartSec=5
User=www-data
Group=www-data

[Install]
WantedBy=multi-user.target
UNIT

sudo chown -R www-data:www-data /opt/nari-surokkha/data
sudo systemctl daemon-reload
sudo systemctl enable --now nari-api
sudo systemctl status nari-api --no-pager
curl -s http://127.0.0.1:3001/health/live      # -> ok
```

Logs: `journalctl -u nari-api -f`

---

## 6. Build the portals (static files)

The API URL is baked in at build time, so pass it as env vars:

```bash
cd /opt/nari-surokkha
VITE_API_URL=https://api.mystrix-soft.com/api/v1 VITE_WS_URL=https://api.mystrix-soft.com \
  npm run build --workspace=apps/admin-portal
VITE_API_URL=https://api.mystrix-soft.com/api/v1 VITE_WS_URL=https://api.mystrix-soft.com \
  npm run build --workspace=apps/police-portal

sudo mkdir -p /var/www/admin.mystrix-soft.com /var/www/police.mystrix-soft.com
sudo cp -r apps/admin-portal/dist/*  /var/www/admin.mystrix-soft.com/
sudo cp -r apps/police-portal/dist/* /var/www/police.mystrix-soft.com/
```

---

## 7. Nginx

```bash
sudo tee /etc/nginx/sites-available/nari-surokkha >/dev/null <<'NGINX'
# ---- API (proxy to Node) ----
server {
    server_name api.mystrix-soft.com;
    client_max_body_size 25m;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        # WebSocket / Socket.IO / WebRTC signaling
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600s;
    }
    listen 80;
}

# ---- Admin portal (static SPA) ----
server {
    server_name admin.mystrix-soft.com;
    root /var/www/admin.mystrix-soft.com;
    index index.html;
    location / { try_files $uri $uri/ /index.html; }
    listen 80;
}

# ---- Police portal (static SPA) ----
server {
    server_name police.mystrix-soft.com;
    root /var/www/police.mystrix-soft.com;
    index index.html;
    location / { try_files $uri $uri/ /index.html; }
    listen 80;
}
NGINX

sudo ln -sf /etc/nginx/sites-available/nari-surokkha /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

---

## 8. TLS (Let's Encrypt)

```bash
sudo certbot --nginx \
  -d api.mystrix-soft.com -d admin.mystrix-soft.com -d police.mystrix-soft.com
```

Certbot edits the Nginx config to add HTTPS + auto-redirect, and installs a
renewal timer. Verify:

- `https://api.mystrix-soft.com/health` → JSON status
- `https://admin.mystrix-soft.com` and `https://police.mystrix-soft.com` load

---

## 9. Firewall (optional but recommended)

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw --force enable
```

Postgres/Redis stay on localhost — do NOT open 5432/6379 to the internet.

---

## Updating later

```bash
cd /opt/nari-surokkha && git pull
npm ci
npm run build --workspace=packages/shared
cd services/api && npx prisma migrate deploy && npm run build
sudo systemctl restart nari-api
# rebuild portals only if their code changed (section 6), then re-copy to /var/www
```

---

## Notes

- **ML service** (`services/ml-service`, FastAPI) is optional and its endpoints
  are currently mocked. To run it, install Python 3.11 + `pip install -r
  services/ml-service/requirements.txt`, run it on `127.0.0.1:8000` via a second
  systemd unit, and add `ML_SERVICE_URL=http://127.0.0.1:8000` to the API `.env`.
- **Push / SMS / S3** stay in mock mode unless you add `FIREBASE_*`, the SMS
  provider (managed in the Admin Portal), and `AWS_S3_*` to the `.env`.
- Evidence uploads are written to `data/uploads` — back that folder up along
  with nightly `pg_dump nari_surokkha`.
