# Nari Surokkha — Performance & Scalability Rating (Revision 4)

**Repository:** `D:\Productions\nari-surokkha`
**Branch:** `fix/critical-perf-2026-08` (through `1d52fb3`)
**Date:** 19 August 2026
**Supersedes:** `PERFORMANCE_SCALABILITY_RATING_v3.md`

---

## 1. The headline

The previous report ended by saying **"7.8 is a paper score until step 2 of §6
runs"** — until someone actually applied the migrations and checked the query
plan.

That check has now run, against a real PostgreSQL 16 + PostGIS 3.4 instance
matching the production image. **It found a bug in the central fix of the whole
engagement.**

The `AND location IS NOT NULL` guard added alongside the geography queries
reads as harmless defensive SQL. It is not. The planner satisfies that
predicate with the plain geometry index and then evaluates `ST_DWithin` as a
row filter — so the geography expression index was never consulted:

| Query form | Plan | Rows filtered | Time |
|---|---|---|---|
| With the guard | `Index Cond: (location IS NOT NULL)` | 17,855 of 20,000 | ~63 ms |
| **Without it** | `Bitmap Index Scan on idx_responders_location_geog` | 908 of 3,053 | **~17 ms** |

The guard was redundant anyway — `ST_DWithin(NULL, …)` is `NULL`, which `WHERE`
already treats as false. Removed from all four spatial queries in `66dd530`.

This is worth dwelling on, because it is the same failure mode as the original
finding: **a spatial query that returns entirely correct results, just slowly.**
Nothing breaks. No test fails. It is invisible until someone reads a query
plan. CI now asserts the index is in use on every PR, so it cannot come back.

---

## 2. Scorecard

| Dimension | R1 | R2 | R3 | **R4** | This round |
|---|:--:|:--:|:--:|:--:|---|
| **Performance (API)** | 5.5 | 7.5 | 8.5 | **9.0** | ▲ 0.5 — spatial fix now verified working; uploads no longer buffer |
| **Scalability** | 4.0 | 5.0 | 7.5 | **9.0** | ▲ 1.5 — the last blocker is gone; genuinely multi-host |
| **Database design** | 7.0 | 8.5 | 9.0 | **9.5** | ▲ 0.5 — migrations proven against real PostGIS; replica support |
| **Architecture & quality** | 7.0 | 7.5 | 8.0 | **8.5** | ▲ 0.5 — one storage implementation, dead config identified |
| **Security** | 6.5 | 7.0 | 8.0 | **8.5** | ▲ 0.5 — S6 and S7 closed; S9 shown to be mis-stated |
| **Reliability** | 3.0 | 5.0 | 7.0 | **8.0** | ▲ 1.0 — offline outbox, restore test, truncation rollback |
| **Observability** | 3.0 | 3.0 | 8.0 | **8.0** | — unchanged, still unrun in production |
| **Data protection** | — | — | — | **7.5** | new row — was folded into Security and understated there |
| **Frontend** | 5.0 | 5.0 | 6.5 | **7.5** | ▲ 1.0 — maps lazy-loaded, bundle budget enforced in CI |
| **Mobile** | 6.0 | 6.0 | 6.0 | **7.5** | ▲ 1.5 — offline ping outbox, per-environment builds |
| **Testing & CI** | 4.5 | 5.5 | 6.5 | **8.5** | ▲ 2.0 — coverage gate, migration + EXPLAIN + bundle + Docker gates |
| **Overall** | **5.4** | **6.6** | **7.8** | **8.6** | ▲ 3.2 across the engagement |

I split **Data protection** into its own row this round. Folding it into
Security understated it: encryption, retention, erasure and disaster recovery
are a distinct concern for a platform holding recordings of assaults, and
7.5 is a fairer statement than burying it inside 8.5.

---

## 3. What was verified, not just written

This is the part that separates revision 4 from its predecessors.

| Verification | Result |
|---|---|
| All 8 migrations applied in order to PostgreSQL 16 + PostGIS 3.4 | ✅ clean |
| Both new migrations re-applied | ✅ idempotent |
| Responder query uses `idx_responders_location_geog` | ✅ after fixing the guard |
| Result parity old vs new spatial query | ✅ 2,145 vs 2,137 — explained: spheroid vs sphere, all within ~25 m of the boundary |
| `prune_old_records()` deletes a 200-day-closed alert's trail | ✅ 500 rows |
| …and preserves an **open** alert's trail | ✅ 500 rows kept |
| Trigram index used for `ILIKE '%…%'` | ✅ `Bitmap Index Scan on idx_users_phone_trgm`, 1.8 ms |
| `case_number_seq` allocates without collision | ✅ |
| k6 scripts parse and thresholds register | ✅ all three |
| `sos-spike.js` run end-to-end against a stub API | ✅ 240 requests, all checks green |
| `location-soak.js` run end-to-end | ✅ 10 VUs, 1 alert each, pings at correct cadence |
| API type-check | ✅ no errors attributable to any change |
| Unit tests | ✅ **84 passing** (was 60 at the start) |

The 12 remaining test failures are unchanged and environmental — `prisma
generate` cannot run in this sandbox (`binaries.prisma.sh` is blocked), so
tests importing generated enums fail on `Object.values(undefined)`. They
predate all of this work.

---

## 4. Capacity

| Metric | R1 | R3 | **R4** | Limited by |
|---|---|---|---|---|
| SOS trigger p95 | ~600–1500 ms | ~40–80 ms | **~40–80 ms** | one indexed query + one insert |
| Nearby-responder lookup @ 20k | ~200 ms (est.) | ~60 ms (measured, index unused) | **~17 ms (measured)** | index probe |
| SOS triggers/min | ~30–60 | ~1,000+ | **~1,000+** | worker throughput, independently scalable |
| Concurrent active SOS | ~200–500 | ~5,000+ | **~5,000+** | socket capacity |
| Concurrent evidence uploads | ~20 (memory-bound) | ~20 | **hundreds** | network, not heap |
| API hosts | 1 | 1 | **many** | nothing — evidence is in object storage |

The responder-lookup row is now a **measurement**, not an estimate. The rest
still are estimates; `load/` exists to replace them and cannot be run from here
(see §6).

---

## 5. What this round fixed

**P10 — evidence storage.** Uploads stream from the multipart request straight
to S3/R2/MinIO; memory is now flat regardless of file size or concurrency.
Every object is encrypted at rest. Local-disk mode streams too — `writeFileSync`
was blocking the event loop for the whole write, on the request path, during an
emergency. Truncated uploads are rejected and rolled back rather than stored as
silently incomplete evidence. 9 new tests cover checksum integrity across many
chunks, binary round-trip, deletion and path traversal.

**Data protection.** `docs/DATA_PROTECTION.md` states retention per data class,
encryption, who may read evidence, the erasure path, and explicit RPO (24 h) /
RTO (4 h) with a recovery procedure — and names five gaps that remain.
`restore-test.sh` makes "we have backups" checkable: it restores the newest dump
to a scratch database and verifies PostGIS came back, geometry columns and GIST
indexes survived, sync triggers exist, a spatial query runs, and migration
history is intact. A dump that restores without its geometry columns looks
completely fine and leaves every spatial query sequential-scanning.

`DELETE /evidence/:id` lets a user erase a recording of the worst moment of
their life — refused while a police case is open, and audit-logged.

**Security.** Login backoff is now per *account*, not per IP, so credential
stuffing from a botnet is actually addressed. It backs off rather than locking,
because a hard lock would let anyone who knows a phone number lock that person
out of an emergency app deliberately. Cookies are `SameSite=strict` and
cookie-authenticated writes require an allowed Origin.

**Mobile.** Location pings that fail now queue in a durable outbox and replay
with their original fix time, which the API accepts and clamps. Coverage is
worst exactly where this app matters most, and a silent gap in the trail is
indistinguishable from "she stopped moving". The production API URL is no
longer a constant in source, so staging and production can finally be different
builds.

**CI.** Coverage is a gate. Migrations are applied to real PostGIS on every PR,
re-applied for idempotency, and then `EXPLAIN` asserts the geography index is in
use — the regression guard for the bug in §1. Retention is asserted not to
delete an open case's trail. Portals fail the build if the entry chunk exceeds
700 KB or chunk count drops below 4. Docker images are built.

---

## 6. What remains

Honestly and completely.

### 🟠 The load tests have still not run against real infrastructure

They now demonstrably work — both HTTP scripts were executed end-to-end against
a stub and passed their thresholds — but a stub is not your system. I have no
route to your staging environment from here. **This is the last unverified
claim in §4**, and running it is a ten-minute job:

```bash
BASE_URL=https://api.staging... TEST_PHONE=... TEST_PASSWORD=... k6 run load/sos-spike.js
```

Set `SMS_PROVIDER=mock` on the target first — `sos-spike.js` creates real
alerts, which create real police cases.

### 🟡 Observability is built but has never watched real traffic

Unchanged at 8.0 for that reason. Every metric, alert rule and dashboard is
theoretical until it has seen a production week and you have tuned the
thresholds that turn out to be noisy.

### 🟡 Data protection gaps, stated in the doc

1. No point-in-time recovery — daily dumps only, so RPO is 24 hours.
2. The **database volume is not encrypted at rest**. Evidence objects now are;
   location trails and phone numbers in Postgres are not.
3. `restore-test.sh` is not yet scheduled.
4. Single region, single host — loss of the VPS is a manual recovery.
5. No data-processing agreement with the SMS provider, who necessarily sees
   recipient numbers and the tracking link.

### 🟡 The ML service is dead weight

`ML_SERVICE_URL` and `ML_SERVICE_API_KEY` are declared in `env.ts` and
referenced nowhere. Detection runs on-device; the API never calls the FastAPI
service. It is deployed, requires a key, and serves no traffic from us. Decide:
use it, or drop it and its two env vars.

### 🟡 Smaller

- Portals still use raw axios + zustand; TanStack Query would remove a class of
  bug as well as duplicate requests. Not attempted — it touches every component
  and deserves its own change.
- No tests in either portal, or the mobile app.
- No table partitioning (the chunked retention sweep substitutes at current
  volumes).
- `apps/mobile` location cadence is distance-adaptive now but not
  battery-aware.

---

## 7. Before you merge

```bash
npm install --legacy-peer-deps          # new deps: lib-storage, prom-client, sentry, bull-board
cd services/api
npx prisma generate                     # closes the sandbox verification gap
npm run type-check
npm run test:coverage                   # now a gate
npx prisma migrate deploy               # NEVER db push
```

Then confirm in production what CI confirms on every PR:

```sql
EXPLAIN SELECT id FROM responders
WHERE status='verified' AND availability='available'
  AND ST_DWithin(location::geography,
                 ST_SetSRID(ST_MakePoint(90.41,23.81),4326)::geography, 5000);
-- expect: Bitmap Index Scan on idx_responders_location_geog
```

---

## 8. Closing

Four revisions ago this was a system whose foundations had been built and left
unwired — PostGIS columns created and never queried, a queue built and
bypassed, Redis idle, Sentry configured and never initialised. **8.6** is a
different kind of system: one where the emergency path is fast, the failure
modes are handled, the sensitive data has a stated lifecycle, and the things
that could silently regress are asserted in CI.

The most useful thing to come out of this round was not a feature. It was that
running one `EXPLAIN` against a real database invalidated the central claim of
the previous report. The fix had been reviewed, type-checked, unit-tested and
committed, and it was still wrong — in the exact way the original bug was
wrong, producing correct results slowly.

That is the lesson worth keeping: **for this class of problem, correctness
tests do not help.** Only a query plan does. The CI job added in `a100e77` is
therefore the single most valuable thing in this changeset, well above any of
the performance work it protects.

One number remains unmeasured, and it is the one everything else rests on. Run
the load tests.

---

*Revision 4, 19 August 2026. `fix/critical-perf-2026-08` at `1d52fb3` —
22 commits, 84 files, +6,329 / −692. Pre-merge.*
