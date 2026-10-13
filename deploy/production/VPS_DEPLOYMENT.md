# Nari Surokkha: VPS deployment guide

This guide takes a fresh Ubuntu VPS to the full production stack: API, worker, admin portal, PostgreSQL + PostGIS, PgBouncer, Redis, TURN relay, TLS, backups and monitoring. Then it covers the mobile app build that points at the server.

**Time:** about 1–2 hours the first time.

**How it works:** you run four scripts, each of which checks its own work:

| Script | Runs as | What it does |
|---|---|---|
| `vps-setup.sh` | root, once | Docker, firewall, fail2ban, security updates, swap, a `deploy` user |
| `init-env.sh` | deploy user, once | Writes `.env.production` with strong random secrets for your domain |
| `issue-certs.sh` | root, once | Gets the HTTPS certificates and sets up automatic renewal |
| `deploy.sh` | deploy user, every update | Pre-flight checks, build, migrate, start, HTTPS smoke test |

> This is an emergency service. Do a full test run before real users depend on it (step 11).

---

## What runs on the server

```
                     Internet
                        │
         443 ┌──────────┴───────────┐ 3478 + 49152–49200/udp
             │  nginx (TLS, limits)  │            coturn (TURN relay)
             └───┬──────────────┬────┘
      api.<domain>│              │admin.<domain>
        ┌─────────▼──┐     ┌─────▼────────┐
        │  API (×N)  │     │ Admin portal │
        └──┬─────┬───┘     └──────────────┘
           │     │  ┌────────┐
           │     └─►│ Redis  │◄── Worker (SMS, push, dispatch, escalation, retention)
        ┌──▼──────┐ └────────┘
        │PgBouncer├──► PostgreSQL 16 + PostGIS
        └─────────┘
```

| Service | Public? | Notes |
|---|---|---|
| nginx | 80, 443 | TLS, rate limits, security headers, CSP |
| API | via nginx: `https://api.<domain>` | REST + Socket.IO |
| Worker | no | Background jobs (same image as the API) |
| Admin portal | via nginx: `https://admin.<domain>` | Static site |
| PostgreSQL + PostGIS, PgBouncer, Redis | no | Internal network only, password-protected |
| coturn | 3478 tcp/udp, 49152–49200 udp | Live audio/video across mobile networks |
| Prometheus, Alertmanager, Grafana | no (Grafana via SSH tunnel) | Optional `monitoring` profile |
| OSRM | no | Optional `osrm` profile (self-hosted Safe Route routing) |

---

## 1. What you need first

| Item | Recommendation |
|---|---|
| VPS | **4 vCPU / 8 GB RAM / 80 GB SSD**, Ubuntu 24.04 LTS. Minimum for a pilot: 2 vCPU / 4 GB (the scripts add swap and size Postgres for you). A provider with a data centre in Singapore or Mumbai keeps latency to Bangladesh low. |
| Domain | Any domain you control, e.g. `example.com`. The app uses `api.example.com` and `admin.example.com`. |
| SSH access | You can log in as root (or a sudo user) with an SSH key. |
| Git repository | This repo on GitHub (private is fine; see 3.1). |
| SMS provider | A BulkSMSBD or Twilio account with credit, plus an approved sender ID for Bangladesh. Needed for SOS texts and sign-up codes. |
| Firebase project | Push notifications (recommended). |
| Off-site bucket | Cloudflare R2, Backblaze B2 or S3, for encrypted backups. |
| Expo account | Building the mobile app (`eas build`). |

---

## 2. DNS

At your DNS provider, create two **A records** pointing at the VPS's public IPv4 address:

| Type | Name | Value |
|---|---|---|
| A | `api` | `<VPS IP>` |
| A | `admin` | `<VPS IP>` |

If you use Cloudflare, set both to **DNS only** (grey cloud): TURN and Let's Encrypt need to reach the server directly.

Check from your PC. Both commands must print the VPS IP before you continue to step 5:

```bash
nslookup api.example.com
nslookup admin.example.com
```

---

## 3. Prepare the server (as root)

```bash
ssh root@<VPS IP>
apt-get update && apt-get install -y git
git clone https://github.com/<you>/nari-surokkha.git /opt/nari-surokkha
bash /opt/nari-surokkha/deploy/production/scripts/vps-setup.sh
```

`vps-setup.sh` does the following:

- Installs Docker + Compose, certbot, ufw, fail2ban, unattended-upgrades and age.
- Opens only ports 22, 80, 443, 3478 and 49152–49200/udp.
- Adds 2 GB swap on machines with less than 8 GB RAM.
- Creates the user **`deploy`** (in the `docker` group) with your root SSH keys, and gives it `/opt/nari-surokkha`.

**Optional, recommended:** after confirming `ssh deploy@<VPS IP>` works, disable root and password logins. Set `PermitRootLogin no` and `PasswordAuthentication no` in `/etc/ssh/sshd_config`, then run `systemctl restart ssh`.

### 3.1 Private repository

Give the server read-only access with a **deploy key**:

1. Run `ssh-keygen -t ed25519 -f ~/.ssh/nari_deploy -N ""` on the server.
2. Add the `.pub` file in GitHub under **Settings → Deploy keys**.
3. Clone with `git clone git@github.com:<you>/nari-surokkha.git`, using that key via `~/.ssh/config`.

Alternatively, use an HTTPS URL with a fine-grained personal access token.

---

## 4. Configure (as `deploy`)

```bash
su - deploy
cd /opt/nari-surokkha
bash deploy/production/scripts/init-env.sh example.com
```

This writes `.env.production` (mode 600) with:

- every secret randomly generated: database, Redis, JWT, encryption key, TURN, evidence signing;
- every URL derived from your domain;
- Postgres and Redis sized to the server's RAM;
- evidence stored on the server disk.

**Save `CONFIG_ENCRYPTION_KEY` in your password manager.** Without it, the SMS and payment-gateway secrets saved in the database can't be read after a restore.

Open the file (`nano .env.production`) and fill in what you have now:

| Setting | Why |
|---|---|
| `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` | Push notifications. These come from Firebase Console → Project settings → Service accounts → Generate key. Keep the private key on one line with `\n` escapes. |
| `BACKUP_*` | Encrypted off-site backups (step 9). You can do this after the first deploy. |
| `ALERT_WEBHOOK_URL` | Only for the monitoring profile (step 10). |
| `STORAGE_PROVIDER=cloudflare-r2` + `S3_*` | Optional. Keeps evidence in R2/S3 instead of the server disk. Needed if you ever run more than one server. |

Leave everything else as generated.

---

## 5. HTTPS certificates (as root, once)

```bash
exit                                  # back to root
bash /opt/nari-surokkha/deploy/production/scripts/issue-certs.sh example.com you@example.com
```

The script does the following:

- refuses to run until both DNS names resolve;
- gets one Let's Encrypt certificate for `api.` and `admin.`;
- switches renewal to go through the running nginx;
- adds a hook that reloads nginx after each renewal.

Renewal is automatic from then on (`certbot.timer`).

---

## 6. Deploy (as `deploy`)

```bash
su - deploy
cd /opt/nari-surokkha
bash deploy/production/scripts/deploy.sh
```

`deploy.sh` runs these steps in order and stops at the first problem, with a message saying what to fix:

1. **Pre-flight.** Checks:
   - Docker;
   - `.env.production` is complete, with no placeholders;
   - DNS points here;
   - the Compose file is valid;
   - the certificate exists.
2. **Images.** Builds the API and admin portal images on the server (about 5–10 min the first time).
3. **Database.** Starts Postgres, Redis and PgBouncer, applies migrations (`prisma migrate deploy`) and seeds the system roles. No demo users are created in production.
4. **App.** Starts the API, worker, admin portal, coturn and nginx, and waits until they are healthy.
5. **Smoke test.** Calls `https://api.<domain>/health/ready` and `https://admin.<domain>/` over HTTPS.

Check it yourself:

```bash
curl https://api.example.com/health/ready     # {"status":"ok",...,"database":"ok","redis":"ok"}
docker compose -f docker-compose.prod.yml --env-file .env.production ps
```

---

## 7. First administrator

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production \
  run --rm api node dist/scripts/create-admin.js
```

It asks for a phone number (`+8801…`), a name, an optional email and a password (at least 12 characters, hidden while typing). Sign in at `https://admin.example.com` with that phone number and password.

Run the same command again for the same phone number to reset a forgotten admin password. Create every other admin from the portal (**Users**).

---

## 8. Set up the service in the admin portal

1. **Settings → SMS Gateway:**
   - Choose BulkSMSBD or Twilio and enter the API key and sender ID.
   - Switch on "Send SMS to trusted contacts on every SOS".
   - **Save**, then **Send a test SMS** to your phone.
   - Registration needs this: new users get their sign-up code by SMS.
2. **Settings → SOS Message:** review the text contacts receive. Keep it short, because Bangla text costs more SMS parts.
3. **Settings → Maps:** optional Google Maps key. Without one, the free OpenStreetMap is used.
4. **Payment Gateways:**
   - Add SSLCommerz and/or Stripe.
   - **Test connection**, then tick **Show in app**.
   - For Stripe, register the webhook URL shown on the card in the Stripe dashboard.
5. **Users:** add the other admins with their own passwords and only the permissions they need.

---

## 9. Backups

Back up from day one: this database holds emergency records.

**On your own PC** (never on the server), create a key pair:

```bash
age-keygen -o nari-backup.key     # keep this file safe and offline; it prints "Public key: age1…"
```

**On the server:**

1. In `.env.production`, set:
   - `BACKUP_AGE_RECIPIENT=age1…` (the public key from your PC);
   - `BACKUP_S3_URI`, `BACKUP_S3_ENDPOINT` and `BACKUP_AWS_*`, from an R2/B2 bucket and API token.
2. Enable the daily backup:

```bash
sudo cp deploy/production/systemd/nari-backup.* /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now nari-backup.timer
sudo systemctl start nari-backup.service && journalctl -u nari-backup -n 30   # first backup now
```

3. Test a restore once a month: `deploy/production/systemd/nari-restore-test.*` automates this.

Point-in-time recovery (WAL-G), retention and the restore procedure are in **`docs/operations/backup-and-restore.md`**.

---

## 10. Monitoring

1. Set `ALERT_WEBHOOK_URL` (a Slack incoming webhook, or a Discord webhook with `/slack` appended).
2. Start the monitoring profile:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production --profile monitoring up -d
ssh -L 3000:localhost:3000 deploy@<VPS IP>     # then open http://localhost:3000 (admin / GRAFANA_PASSWORD)
```

3. Also add an **external** uptime check (UptimeRobot, Better Stack, healthchecks.io) on `https://api.example.com/health/ready`. It is the only alert that still works when the whole server is down.

---

## 11. Mobile app

1. In `apps/mobile/app.json`, set `expo.extra.apiUrl` to `https://api.example.com/api/v1` and `expo.extra.wsUrl` to `https://api.example.com`.
2. Put your Firebase `google-services.json` in `apps/mobile/`.
3. Build:

```bash
cd apps/mobile
npm install -g eas-cli && eas login
eas build --profile preview --platform android      # APK for testing on real phones
eas build --profile production --platform android  # store bundle (AAB)
```

Production builds turn off plain-HTTP traffic and use your HTTPS API. Store requirements (SMS, background location and microphone declarations, Data Safety form) are in **`docs/store-release.md`**.

### Go-live test (do not skip)

On two Android phones on **different mobile networks**:

- [ ] Register a new account. The SMS code arrives.
- [ ] Add a trusted contact. The contact receives the consent SMS and taps "I agree".
- [ ] Press SOS:
  - [ ] the contact receives the SMS with a working tracking link;
  - [ ] the admin portal sounds the siren and shows the alert live.
- [ ] Location keeps updating with the screen off.
- [ ] Live audio/video works from phone to portal. This tests TURN across networks.
- [ ] A responder accepts the dispatch and sees the live location.
- [ ] With mobile data off, SOS goes out as SMS from the phone's SIM (multi-part text arrives complete).
- [ ] "I'm safe" ends the alert, and Resolve in the portal ends it on the phone.
- [ ] Report an incident with a photo. It appears in the portal, without location in the photo's EXIF.
- [ ] A restore test of last night's backup succeeds.

---

## 12. Updating

```bash
su - deploy                                # or: ssh deploy@<VPS IP>
cd /opt/nari-surokkha
git pull                                   # or: git fetch --tags && git checkout v1.2.0
bash deploy/production/scripts/deploy.sh   # rebuilds, migrates, restarts only what changed
```

**Rollback:** check out the previous tag and run `deploy.sh` again. Migrations only move forward, so if a migration itself must be undone, restore from backup.

**Automated deploys from GitHub (optional):**

1. In the repository settings, add:

   | Kind | Name | Value |
   |---|---|---|
   | Secret | `VPS_HOST` | server IP or hostname |
   | Secret | `VPS_USER` | `deploy` |
   | Secret | `VPS_SSH_KEY` | private key for the deploy user |
   | Secret | `VPS_APP_DIR` | `/opt/nari-surokkha` |
   | Variable | `PUBLIC_API_URL` | `https://api.<domain>/api/v1` |
   | Variable | `PUBLIC_WS_URL` | `https://api.<domain>` |

2. Push a tag such as `git tag v1.0.0 && git push origin v1.0.0`.
3. `.github/workflows/deploy.yml` then:
   - builds the images and pushes them to GHCR;
   - checks out exactly that tag on the server;
   - migrates and restarts.

   Set `REGISTRY=ghcr.io/<you>/nari-surokkha` in `.env.production` and use `deploy.sh --pull` for manual runs.

---

## 13. Day-to-day operations

```bash
C="docker compose -f docker-compose.prod.yml --env-file .env.production"
$C ps                              # status of every service
$C logs -f --tail=100 api worker   # live logs
$C restart worker                  # restart one service
$C up -d --scale api=3             # more API capacity (nginx picks them up automatically)
$C exec postgres psql -U nari_user nari_surokkha   # database shell
```

| Symptom | Likely cause | Fix |
|---|---|---|
| `deploy.sh`: "DNS … does not resolve" | A record missing or not propagated | Check step 2; wait a few minutes |
| `issue-certs.sh` fails | Port 80 blocked, or DNS proxied (orange cloud) | `ufw status`; set Cloudflare to DNS only |
| `https://api…` returns 502 | API not healthy | `$C logs api`; usually a wrong value in `.env.production` (the API prints which variable) |
| Sign-up code never arrives | SMS gateway not configured, or no credit | Portal → Settings → SMS Gateway → Send test SMS |
| Live video works on Wi-Fi but not on mobile data | TURN not reachable | `ufw status` must show 3478 and 49152:49200/udp. Check any cloud-provider firewall too. |
| Admin portal shows "API server could not be reached" | Portal built with the wrong API URL | `ADMIN_VITE_API_URL` in `.env.production`, then `deploy.sh` (rebuilds the portal) |
| Disk filling up | Evidence on local disk, or old images | `df -h`; `docker image prune -a`; consider R2 for evidence |

---

## 14. Optional

- **Self-hosted routing for Safe Route.** Without it, routing uses the public OSRM demo server, which is not meant for production. Run:

  ```bash
  ./scripts/osrm-prepare.sh
  $C --profile osrm up -d osrm
  ```

  OSRM needs about 2 GB RAM extra.
- **Evidence in Cloudflare R2.** Set `STORAGE_PROVIDER=cloudflare-r2` and `S3_*`, then run `deploy.sh`. Copy any files already in `data/uploads` to the bucket first.
- **Staging server.** `deploy/STAGING_README.md` gives the same stack on a second, smaller VPS for testing updates before production.
