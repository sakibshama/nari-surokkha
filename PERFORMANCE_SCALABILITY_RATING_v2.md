# Nari Surokkha — Performance & Scalability Rating (Revision 2)

**Repository:** `D:\Productions\nari-surokkha`
**Branch reviewed:** `fix/critical-perf-2026-08` (through commit `6ab0981`)
**Date:** 19 August 2026
**Supersedes:** `PERFORMANCE_SCALABILITY_ANALYSIS.md` (same date, pre-fix)

---

## 1. What changed since revision 1

Five commits landed, addressing every 🔴 critical finding, the two 🟠 findings
that leaked data or cost money, and one latent correctness bug:

| Commit | Fix |
|---|---|
| `fbc4c75` | Spatial queries use the GIST-indexed `location` column + new index migration |
| `4a8c347` | SOS fan-out moved off the request path into a `dispatch` queue |
| `b20fc87` | Notification retries no longer re-send SMS; phone matching fixed |
| `db7ff2e` | Two global socket broadcasts scoped to rooms |
| `6ab0981` | Case numbers allocated from a sequence, not 4 random hex chars |

1,368 insertions across 22 files, of which ~475 lines are new tests.

---

## 2. Scorecard

| Dimension | Rev 1 | **Rev 2** | Movement |
|---|:--:|:--:|---|
| **Performance (API)** | 5.5 | **7.5** | ▲ 2.0 — the two worst hot paths are fixed; write amplification remains |
| **Scalability** | 4.0 | **5.0** | ▲ 1.0 — O(n) scans gone, but the four single-instance blockers are untouched |
| **Database design** | 7.0 | **8.5** | ▲ 1.5 — indexes are finally used; composites and a unique constraint added |
| **Architecture & code quality** | 7.0 | **7.5** | ▲ 0.5 — clean request/queue split, three shared utils, one allocator not two |
| **Security** | 6.5 | **7.0** | ▲ 0.5 — the broadcast leak is closed; the auth-model issues remain |
| **Reliability** | 3.0 | **5.0** | ▲ 2.0 — idempotent retries, failure isolation, job history retained |
| **Observability** | 3.0 | **3.0** | — still no metrics, tracing, error tracking or alerting |
| **Frontend performance** | 5.0 | **5.0** | — untouched |
| **Mobile performance** | 6.0 | **6.0** | — untouched |
| **Testing & CI** | 4.5 | **5.5** | ▲ 1.0 — 14 new tests on the changed paths; still no load testing |
| **Overall** | **5.4** | **6.6** | ▲ 1.2 |

> Reliability and observability were one row in revision 1. They have been
> split because they moved in different directions: the system now *recovers*
> from failure far better, while your ability to *see* failure is unchanged.

---

## 3. Capacity, re-estimated

| Metric | Rev 1 | **Rev 2** | Now limited by |
|---|---|---|---|
| SOS trigger p95 latency | ~600–1500 ms | **~40–80 ms** | one indexed query + one insert |
| SOS triggers per minute | ~30–60 | **~300+** | queue drain rate, not the request |
| Registered users | ~50k (fails ~250k) | **~500k+** | no longer the responder table scan |
| Concurrent active SOS | ~200–500 | **~200–500** | *unchanged* — location-ping writes (P4) |
| Concurrent WebSocket clients | ~3–5k | **~5–8k** | single Node process; per-request logging |
| Police dashboards | ~50 officers | **~50 officers** | *unchanged* — unbounded station query (P7) |

Still code-derived estimates, not measurements. The single most valuable next
step remains making them measurable.

---

## 4. What each fix bought

**Spatial queries (`fbc4c75`) — the biggest single win.** The GIST indexes and
sync triggers had existed since the init migration; nothing queried them. All
four spatial queries now hit `location::geography`, index-assisted. Nearby-
responder lookup goes from an O(n) scan to an index probe — roughly 200 ms →
under 5 ms at 100k responders — and the same applies to Safe Route scoring,
which previously scanned `incident_reports` on every request. The migration
also backfills NULL geometries, adds composite indexes for the station
dashboard and case list, and adds a unique `(alert_id, responder_id)` on
`responder_dispatches`.

**SOS fan-out (`4a8c347`).** The panic button no longer waits on fifteen
sequential round trips. The request path is now: nearest station → insert
alert → queue notifications → emit to the police portal → queue `fan_out_alert`
→ return. In the worker, the per-responder insert became one `createMany`, the
N+1 device-token query became one `findMany`, and the un-awaited per-responder
`fetch()` became a batched, awaited, timeout-bounded Expo call. Deterministic
`jobId`s make a retried SOS unable to double-dispatch.

**Notification retries (`b20fc87`).** One job per contact, plus a
`notification_logs` check before each send, so a retry re-attempts only what
actually failed. This stops the system billing you for — and confusing a
family with — duplicate emergency SMS. A quieter bug surfaced while fixing it:
push delivery matched phone numbers by exact string, so a contact saved as
`01712345678` never matched a user registered as `+8801712345678`. Those
contacts were silently getting SMS only.

**Socket broadcasts (`db7ff2e`).** Two `io.emit()` calls were telling every
connected client on the platform that evidence had been uploaded for alert X.
Both are now scoped to the alert room, the handling station and dispatch. This
was as much a privacy fix as a performance one.

**Case numbers (`6ab0981`).** 4 hex characters is 65,536 values per year
against a UNIQUE column — a collision becomes more likely than not at ~300
cases, at which point case creation starts failing and SOS alerts stop landing
in station queues. One sequence-backed allocator now replaces that and the
competing `Date.now()` generator.

---

## 5. What is still open

Ordered by what I would do next.

### 🔴 Observability — unchanged at 3.0, now the top gap

`SENTRY_DSN` is still declared in `env.ts` and referenced nowhere. No
`/metrics`, no tracing, no alerting. Every number in §3 is inferred from
reading code. **Until `sos_dispatch_duration_seconds` is on a dashboard with
an alert attached, you cannot confirm these fixes worked in production, and you
will not know when something breaks.** Roughly a day's work:
`fastify-metrics`, Sentry init, Prometheus + Grafana + Alertmanager in compose,
`bull-board` for queue depth.

### 🟠 Location-ping write amplification (P4) — now the #1 performance item

Each ping still costs three queries (ownership check, insert, denormalised
update), and the two writes are not in a transaction. With a Safe Route also
active, the same background tick fires a second request that re-reads the route
every time. Fix: cache the ownership check in Redis, wrap the two writes in one
transaction, then buffer pings and flush in batches. This is what caps
concurrent active SOS at a few hundred.

### 🟠 Single-instance blockers — why scalability is 5.0 and not 7.0

Four structural items, none touched:

1. Workers still run inside the API process (`plugins/worker.ts` in `buildApp`)
2. Evidence still lives on a host bind-mount
3. nginx still has one hardcoded `proxy_pass http://api:3001`
4. No PgBouncer

The dispatch work is now *queued*, which is the prerequisite — extracting a
separate worker service is a small change on top.

### 🟡 Still outstanding from revision 1

- **P6** analytics loads 30 days of rows into Node to count them
- **P7** unbounded queries: `getActiveAlertsForStation`, `getCaseTimeline`, audit logs
- **P8** admin search uses unindexed `ILIKE '%…%'`
- **P9** every request logged twice at `info`; no Docker log rotation
- **P10** evidence uploads buffered fully in memory
- **S2** rate limits keyed on IP — a real risk under carrier CGNAT
- **S3** permissions baked into the JWT; revocation waits for expiry
- **S4** no refresh-token rotation or reuse detection
- **S5** seed credentials public in the repo
- Frontend: no code splitting, two mapping libraries, no data-fetching library
- No load testing, no coverage gate

---

## 6. Verification status — read this before merging

The fixes are committed but **not fully verified in your environment.**

What I did verify, in an isolated container:

- **Type check:** zero errors attributable to any of the changes.
- **Unit tests:** every touched file passes — alerts 17/17 (5 new, covering the
  queued fan-out), notifications 10/10 (rewritten, including an explicit
  "does not re-send" test), police 4/4 (1 new), cases 5/5 (1 new).

What I could **not** verify, and why:

- The Prisma client could not be generated in the sandbox
  (`binaries.prisma.sh` is blocked), so 12 tests still fail there on
  `Object.values(<undefined enum>)`, `Prisma.Decimal`, and a storage-directory
  check. All are environmental and all predate these changes — but it means the
  Prisma call sites in the new code (`createMany`, `findFirst`, the `$queryRaw`
  generics) were type-checked *without* the generated client.
- The migration has not been run against any database.

**Please run before merging:**

```bash
cd services/api
npx prisma generate
npm run type-check
npm test
npx prisma migrate deploy      # NEVER db push — it drops the PostGIS columns
```

Then confirm the indexes are actually being used:

```sql
EXPLAIN ANALYZE
SELECT id FROM responders
WHERE status = 'verified' AND availability = 'available'
  AND ST_DWithin(location::geography,
                 ST_SetSRID(ST_MakePoint(90.41, 23.81), 4326)::geography, 5000);
-- expect: Index Scan using idx_responders_location_geog
-- if you see Seq Scan, the backfill did not populate `location`
```

---

## 7. Closing

Revision 1 said the gap between *designed for scale* and *running at scale* was
made up of small, contained items — geometry columns created and never queried,
a queue built and then bypassed, Redis deployed and left idle. Five of those
are now closed, and the two that mattered most — the spatial scans and the SOS
request path — took about a day between them.

The character of the remaining work has changed. What is left is no longer
"finish wiring up what you already built"; it is genuine new work:
instrumentation, extracting a worker service, moving evidence to object
storage, batching location writes. That is a healthier place to be.

One thing has not moved and should move next. A **6.6** with **3.0
observability** is a system that is probably fast and provably blind. Every
performance claim in this document is an inference. Instrument it, and the next
revision of this report can be written from data instead of from reading code.

---

*Revision 2, 19 August 2026. Ratings reflect the state of
`fix/critical-perf-2026-08` at commit `6ab0981`, pre-merge and pre-migration.*
