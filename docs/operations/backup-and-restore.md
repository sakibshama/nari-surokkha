# Backup, restore and point-in-time recovery

Two layers, both encrypted and off-site:

| Layer | Tool | RPO | Use it for |
|---|---|---|---|
| Daily logical backup | `deploy/production/scripts/backup.sh` (`pg_dump` + evidence archive, encrypted with **age**/GPG, uploaded to S3-compatible storage) | 24 h | Disaster recovery, migrating hosts, restore tests, "give me last Tuesday" |
| Continuous WAL archiving | **WAL-G** (`deploy/production/walg/`) | ~1 min | Point-in-time recovery after a bad migration, accidental delete, corruption |

Run the daily layer from day one. Add WAL-G before real users depend on the
system: for an emergency platform, losing up to a day of alerts is too much.

Only **public** keys live on the server. The private keys sit offline (a
password manager plus a printed/USB copy held by two people). Without them no
backup can be read — by an attacker, or by you.

---

## 1. One-time setup

### 1.1 Keys

```bash
# On an admin machine (NOT the server):
age-keygen -o nari-backup.key          # prints "Public key: age1…"
# store nari-backup.key in the password manager + offline copy
```

Put the public key (`age1…`) into `.env.production` as `BACKUP_AGE_RECIPIENT`.
GPG alternative: import a public key on the server (`gpg --import pub.asc`)
and set `BACKUP_GPG_RECIPIENT` to its email/fingerprint.

### 1.2 Bucket

Any S3-compatible store works. Create a **private** bucket in a different
provider/region than the VPS, and an access key scoped to that bucket only.

| Provider | `BACKUP_S3_ENDPOINT` | `BACKUP_S3_REGION` |
|---|---|---|
| Cloudflare R2 | `https://<accountid>.r2.cloudflarestorage.com` | `auto` |
| Backblaze B2 | `https://s3.<region>.backblazeb2.com` | e.g. `us-west-004` |
| AWS S3 | *(empty)* | bucket region |
| Wasabi | `https://s3.<region>.wasabisys.com` | region |

Prefer a key that can write and list but **not delete**, plus bucket
versioning or object lock, so a compromised server cannot erase the backups.
In that case set `BACKUP_REMOTE_PRUNE=false` and let a lifecycle rule expire
old objects (daily: 14 days; keep `*/01/*` for 12 months).

### 1.3 `.env.production`

```dotenv
BACKUP_AGE_RECIPIENT=age1...
BACKUP_S3_URI=s3://nari-backups/production
BACKUP_S3_ENDPOINT=https://<accountid>.r2.cloudflarestorage.com
BACKUP_S3_REGION=auto
BACKUP_AWS_ACCESS_KEY_ID=...
BACKUP_AWS_SECRET_ACCESS_KEY=...
BACKUP_RETENTION_DAYS=14               # daily copies kept
BACKUP_MONTHLY_RETENTION_MONTHS=12     # plus the 1st of each month
BACKUP_LOCAL_RETENTION_DAYS=3          # encrypted local copies for fast restores
BACKUP_HEALTHCHECK_URL=https://hc-ping.com/<uuid>   # optional dead-man's switch
# BACKUP_UPLOADER=rclone  BACKUP_RCLONE_REMOTE=r2:nari-backups/production   # alternative
```

The script uses the host `aws` CLI if installed, otherwise the
`amazon/aws-cli` container — nothing else to install. `age` is installed by
`vps-setup.sh`.

### 1.4 Schedule

systemd (recommended — logs in the journal, `Persistent=` catches up after a
reboot):

```bash
sudo cp deploy/production/systemd/nari-backup.service deploy/production/systemd/nari-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now nari-backup.timer
sudo systemctl start nari-backup.service      # run once now
journalctl -u nari-backup.service -n 50
```

or cron:

```cron
15 2 * * * /opt/nari-surokkha/deploy/production/scripts/backup.sh >> /var/log/nari-backup.log 2>&1
```

## 2. What `backup.sh` does

1. `pg_dump --format=custom` of `POSTGRES_DB` from the running `postgres`
   container.
2. Verifies the dump: `pg_restore --list` must parse it and list at least 10
   tables with data.
3. If `STORAGE_PROVIDER=local`, archives `UPLOADS_DIR` (evidence). With R2/S3
   evidence storage, enable versioning/replication on that bucket instead.
4. Encrypts each file (`.age` / `.gpg`) and deletes the plaintext immediately
   (work files live in a `0700` directory).
5. Uploads to `s3://…/YYYY/MM/DD/db-<UTC timestamp>.dump.age` (and
   `uploads-….tar.gz.age`).
6. Retention: deletes remote objects older than `BACKUP_RETENTION_DAYS`,
   except the 1st-of-month copies younger than `BACKUP_MONTHLY_RETENTION_MONTHS`;
   prunes local encrypted copies after `BACKUP_LOCAL_RETENTION_DAYS`.

Exit codes: `0` ok · `2` configuration · `3` dump/verification · `4`
encryption · `5` upload · `6` retention. Any non-zero exit marks the systemd
unit failed and pings `BACKUP_HEALTHCHECK_URL/fail`. A healthchecks.io-style
check with a 26 h period also catches the timer silently not running.

## 3. Restore test (monthly)

`deploy/production/scripts/restore-test.sh` downloads the newest
`db-*.dump.age`, decrypts it, restores it into a **throwaway** PostGIS
container and checks PostGIS, tables, geometry columns, GiST indexes, sync
triggers, user rows, a spatial query and the Prisma migration history. It
never touches the live database.

Run it where the private key is — an admin machine or a small restore host
with Docker — not on the production server:

```bash
export BACKUP_AGE_IDENTITY_FILE=~/keys/nari-backup.key
export BACKUP_S3_URI=s3://nari-backups/production BACKUP_S3_ENDPOINT=https://… \
       BACKUP_AWS_ACCESS_KEY_ID=… BACKUP_AWS_SECRET_ACCESS_KEY=…   # read-only key is enough
deploy/production/scripts/restore-test.sh              # newest remote backup
deploy/production/scripts/restore-test.sh ./db-….dump.age   # a specific file
```

Exit codes: `0` pass · `1` checks failed · `2` configuration · `3`
download/decrypt · `4` restore · `5` restored fine but older than `RPO_HOURS`.
`deploy/production/systemd/nari-restore-test.{service,timer}` runs it on the
1st of each month (env file `/etc/nari-surokkha/restore-test.env`). Record the
printed restore time: it is your RTO for this layer.

## 4. Full restore from a daily backup

```bash
COMPOSE="docker compose -f docker-compose.prod.yml --env-file .env.production"
# 1. Stop writers
$COMPOSE stop api worker
# 2. Fetch + decrypt (on the admin machine), copy db.dump to the server
age -d -i nari-backup.key -o db.dump db-20261012T021500Z.dump.age
# 3. Recreate the database and restore
$COMPOSE exec -T postgres dropdb -U "$POSTGRES_USER" --if-exists "$POSTGRES_DB"
$COMPOSE exec -T postgres createdb -U "$POSTGRES_USER" -T template0 "$POSTGRES_DB"
$COMPOSE exec -T postgres pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --exit-on-error < db.dump
# 4. Evidence (local storage only)
age -d -i nari-backup.key uploads-….tar.gz.age | sudo tar -xzf - -C /opt/nari-surokkha/data
sudo chown -R 1000:1000 /opt/nari-surokkha/data/uploads
# 5. Start
$COMPOSE run --rm api npx prisma migrate deploy   # no-op unless the backup predates a migration
$COMPOSE up -d
```

`CONFIG_ENCRYPTION_KEY` must be the same value as when the backup was taken,
or the stored SMS/payment-gateway secrets cannot be decrypted.

---

## 5. Point-in-time recovery with WAL-G

### 5.1 How it is wired

`deploy/production/walg/Dockerfile` builds the same `postgis/postgis:16-3.4-alpine`
image with a statically built `wal-g` added (the published WAL-G binaries are
glibc-only; switching to a Debian image would change the collation library
under the existing data directory). `docker-compose.walg.yml` overrides the
`postgres` service with that image, the WAL-G environment and these
**Postgres flags**:

```text
-c wal_level=replica
-c archive_mode=on
-c archive_command='wal-g wal-push %p'
-c archive_timeout=60          # ship a segment at least every 60 s → RPO ≈ 1 min
-c max_wal_senders=3
```

(plus the usual tuning flags from `docker-compose.prod.yml`, repeated because
an override's `command` replaces the base one).

**Environment** (in `.env.production`; the override maps them):

```dotenv
WALG_S3_PREFIX=s3://nari-backups/wal           # separate prefix from the daily dumps
WALG_S3_ENDPOINT=https://<accountid>.r2.cloudflarestorage.com
WALG_S3_REGION=auto
WALG_AWS_ACCESS_KEY_ID=...
WALG_AWS_SECRET_ACCESS_KEY=...
WALG_PGP_PUBLIC_KEY_FILE=/opt/nari-surokkha/secrets/walg-public.asc
```

Inside the container this becomes `WALG_S3_PREFIX`, `AWS_ENDPOINT`,
`AWS_REGION`, `AWS_S3_FORCE_PATH_STYLE=true`, `AWS_ACCESS_KEY_ID`,
`AWS_SECRET_ACCESS_KEY`, `WALG_COMPRESSION_METHOD=lz4`,
`WALG_PGP_KEY_PATH=/etc/wal-g/backup-public.asc`, and `PGHOST`/`PGUSER`/`PGDATABASE`
for `backup-push`.

Encryption: WAL-G uses OpenPGP (`WALG_PGP_KEY_PATH`). Generate a dedicated key
pair (`gpg --quick-generate-key "nari wal-g" rsa4096 encrypt never`), export
the **public** key to the server (`gpg --armor --export … > walg-public.asc`)
and keep the private key offline with the age key. Verify on staging that
`wal-g wal-push` works with the public key alone in your WAL-G version; if it
does not, keep a dedicated key pair on the server and rely on bucket-side
write-only credentials for protection.

### 5.2 Enable

```bash
COMPOSE="docker compose -f docker-compose.prod.yml -f deploy/production/walg/docker-compose.walg.yml --env-file .env.production"
$COMPOSE build postgres
$COMPOSE up -d postgres                       # restarts Postgres with archive_mode=on
$COMPOSE exec -T postgres sh -c 'wal-g wal-push --help >/dev/null && echo ok'
# first base backup (as the postgres OS user, so files are readable):
$COMPOSE exec -T -u postgres postgres wal-g backup-push "$PGDATA"
$COMPOSE exec -T -u postgres postgres wal-g backup-list
```

Use this `$COMPOSE` (both `-f` files) for every later `up`, including in the
deploy workflow, or Postgres reverts to the non-archiving image.

### 5.3 Schedule base backups and retention

```cron
# nightly base backup, then keep 7 full backups (+ the WAL needed by them)
30 1 * * * cd /opt/nari-surokkha && docker compose -f docker-compose.prod.yml -f deploy/production/walg/docker-compose.walg.yml --env-file .env.production exec -T -u postgres postgres sh -c 'wal-g backup-push "$PGDATA" && wal-g delete retain FULL 7 --confirm' >> /var/log/nari-walg.log 2>&1
```

Monitor archiving: `SELECT archived_count, failed_count, last_failed_wal FROM pg_stat_archiver;`
A growing `failed_count` means WAL piles up in `pg_wal` and will eventually
fill the disk — alert on it.

### 5.4 Recover to a point in time

On a **new** volume (never over the only copy of the broken data):

```bash
COMPOSE="docker compose -f docker-compose.prod.yml -f deploy/production/walg/docker-compose.walg.yml --env-file .env.production"
$COMPOSE stop api worker pgbouncer postgres
docker volume create nari_pg_restore
# The restore needs the PRIVATE PGP key: mount it read-only for this run only
set -a; . ./.env.production; set +a
docker run --rm -u postgres \
  -e WALG_S3_PREFIX -e AWS_ENDPOINT="$WALG_S3_ENDPOINT" -e AWS_REGION="${WALG_S3_REGION:-auto}" \
  -e AWS_S3_FORCE_PATH_STYLE=true -e AWS_ACCESS_KEY_ID="$WALG_AWS_ACCESS_KEY_ID" \
  -e AWS_SECRET_ACCESS_KEY="$WALG_AWS_SECRET_ACCESS_KEY" \
  -e WALG_PGP_KEY_PATH=/keys/walg-private.asc -v /secure/walg-private.asc:/keys/walg-private.asc:ro \
  -v nari_pg_restore:/var/lib/postgresql/data "${REGISTRY:-nari-surokkha}/postgres-walg:16-3.4" \
  sh -c 'wal-g backup-fetch /var/lib/postgresql/data LATEST &&
         touch /var/lib/postgresql/data/recovery.signal &&
         printf "%s\n" "restore_command = '"'"'wal-g wal-fetch %f %p'"'"'" \
                       "recovery_target_time = '"'"'2026-10-12 14:05:00+06'"'"'" \
                       "recovery_target_action = '"'"'promote'"'"'" >> /var/lib/postgresql/data/postgresql.auto.conf'
```

Then point the `postgres` service at `nari_pg_restore` (or swap volumes),
start it with the same private-key mount and WAL-G env, wait until the log
shows `database system is ready to accept connections` and recovery has
promoted, verify the data, remove the private key mount and restart
normally. Take a fresh `wal-g backup-push` immediately afterwards (a new
timeline starts).

Rehearse this on staging once before you need it, and write the measured time
into this document.

---

## 6. What is not covered

- **Redis** holds queues and live-tracking tokens only; it is rebuilt on
  restart (AOF is on for crash safety). Not backed up off-site.
- **Evidence in R2/S3** (`STORAGE_PROVIDER` ≠ `local`): enable bucket
  versioning and, if possible, replication to a second bucket.
- **`.env.production`** and the private keys: keep an encrypted copy in the
  password manager. A backup without `CONFIG_ENCRYPTION_KEY` restores, but all
  stored gateway secrets must be re-entered.
