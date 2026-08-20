# Data protection and disaster recovery

Nari Surokkha holds some of the most sensitive data a system can hold:
photographs, audio and video recorded during an assault, live location trails
of people in danger, and the phone numbers of their families. This document
states what happens to that data, for how long, and what we do when something
goes wrong.

It is deliberately short. A policy nobody reads protects nobody.

---

## 1. Data classes

| Class | Examples | Sensitivity | Retention |
|---|---|---|---|
| **Evidence** | photos, audio, video uploaded during an alert | Highest | `EVIDENCE_RETENTION_DAYS` (default 365) after the alert is **closed** — never while a case is open |
| **Location trails** | `alert_locations` rows during an active SOS | High | 90 days after the alert is closed |
| **Alerts & cases** | the incident record itself | High | Indefinite (the accountability record) |
| **Audit logs** | who accessed what, when | High | 365 days |
| **Notification logs** | SMS/push delivery attempts | Medium | 180 days |
| **Tracking tokens** | the `/t/:token` link sent to family | High | 24 hours (Redis TTL) |
| **Accounts** | phone, name, trusted contacts | High | Until the user deletes the account |

Retention is enforced by `prune_old_records()` (migration
`20260819100000_retention_and_search`) and the evidence purge in
`services/api/src/plugins/worker.ts`, both run daily by the worker.

**Location trails and evidence are never purged while a case is open against
the alert**, whatever their age. Deleting the record of an assault while
someone is still being prosecuted for it would be far worse than keeping it
too long. The queries encode this explicitly — see
`EvidenceRepository.findExpiredEvidence` and the `closed_at` join in
`prune_old_records`.

---

## 2. Encryption

| Where | How |
|---|---|
| Evidence at rest | Server-side encryption on every object. SSE-S3 (AES256) by default; set `S3_KMS_KEY_ID` for a customer-managed key with its own audit trail. |
| Database at rest | Volume-level encryption on the host. **Not currently configured — see §6.** |
| In transit (public) | TLS 1.2/1.3 at nginx, HSTS enabled |
| In transit (internal) | Docker bridge network, not exposed to the host |
| Passwords | argon2id, 64 MB / 3 iterations / parallelism 4 |
| Refresh tokens | Stored hashed-by-reference in `user_sessions`; rotated on every use, whole family revoked on detected reuse |

Evidence is served through short-lived presigned URLs (15 minutes by default),
never as a public object.

---

## 3. Access to evidence

Every read of an evidence file is written to `evidence_access_logs` with the
accessing user and IP. Access is limited to:

- the **uploader**, for their own evidence
- **police** assigned to the station handling the alert
- **admins** with the relevant permission

A citizen cannot read another citizen's evidence; the check is in
`EvidenceService.listEvidence` and `getFileContent`.

### Right to erasure

`DELETE /api/v1/evidence/:id` lets the uploader permanently delete their own
evidence — both the stored object and its database row. It is refused with
`409` while a police case is open against the alert, and the deletion itself is
recorded in the audit log.

---

## 4. Backups

| Setting | Value |
|---|---|
| What | Full `pg_dump` of the primary, plus the evidence bucket |
| Frequency | Daily |
| Location | `/opt/nari-surokkha/backups` on the VPS, and off-host copy |
| Retention | 30 daily, 12 monthly |
| Encryption | Inherit the bucket's SSE for the off-host copy |

Taken by `deploy/production/scripts/backup.sh`.

### Restore testing

`deploy/production/scripts/restore-test.sh` restores the newest backup into a
scratch database and verifies the things that actually matter — that PostGIS
survived, that the geometry columns and GIST indexes came back, that the sync
triggers exist, that a spatial query runs, and that the migration history is
intact. It drops the scratch database afterwards and never touches production.

**Run it monthly and alert on a non-zero exit.** A dump that restores without
its geometry columns looks fine and leaves every spatial query doing a
sequential scan.

```bash
./deploy/production/scripts/restore-test.sh
```

---

## 5. Objectives

| Objective | Target | Basis |
|---|---|---|
| **RPO** (max data loss) | **24 hours** | Daily backup. Alerts created since the last dump would be lost. |
| **RTO** (max downtime) | **4 hours** | Provision host, restore dump, redeploy compose stack, verify. |
| **RTO for a single container failure** | **< 1 minute** | `restart: unless-stopped` plus nginx `proxy_next_upstream` |

The 24-hour RPO is the weakest number here and is a deliberate, stated choice
rather than an oversight. For an emergency service, losing up to a day of
alerts and evidence is a real harm. Reducing it requires WAL archiving /
point-in-time recovery — see §6.

### Recovery procedure

1. Provision a host, install Docker, clone the repo.
2. Restore `.env.production` from the secret store.
3. `docker compose -f docker-compose.prod.yml up -d postgres redis`
4. Restore the newest dump (see `restore-test.sh` for the exact command).
5. `docker compose ... run --rm api npx prisma migrate deploy` — a no-op on a
   current dump, and the safety net if the dump predates a migration.
6. `docker compose ... up -d`
7. Verify: `/health` returns 200, `/metrics` reports `sos_dispatch_duration`,
   and a test SOS reaches a station.
8. Re-point DNS.

---

## 6. Known gaps

Stated plainly, because an undocumented gap is worse than a documented one.

1. **No point-in-time recovery.** Daily dumps only, so the RPO is 24 hours.
   WAL archiving to object storage would bring it to minutes.
2. **Database volume is not encrypted at rest.** Evidence objects are; the
   Postgres volume relies on host-level disk encryption, which is not currently
   configured. Location trails and phone numbers live there.
3. **Backups are not automatically verified.** `restore-test.sh` exists but is
   not yet scheduled.
4. **Single region, single host.** Loss of the VPS means an outage until §5 is
   executed by hand.
5. **No formal data-processing agreement** with the SMS provider, who
   necessarily sees recipient phone numbers and the tracking link.

---

*Last reviewed: 19 August 2026.*
