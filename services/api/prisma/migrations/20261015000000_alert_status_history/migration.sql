-- ════════════════════════════════════════════════════════════════════════════
-- Alert status history — every SOS / soft alert is a permanent record.
--
-- alert_status_events is an append-only log of every status change of an
-- emergency alert: creation, soft-alert cancel / confirm, auto-escalation,
-- owner cancel / resolve and admin updates. The admin portal renders it as the
-- alert's "Status history" timeline.
--
--   * ADDITIVE: one new table, its constraints and indexes. No existing column
--     or row is changed or removed.
--   * IDEMPOTENT: safe to re-run (IF NOT EXISTS / guarded DO blocks, and the
--     backfill only touches alerts that have no history yet).
--   * The FK to emergency_alerts is ON DELETE RESTRICT, so an alert with
--     history can never be deleted (by code, by cascade or by hand) without
--     first deliberately removing its history.
--   * prune_old_records() (20260819100000) does not touch this table.
--
-- Deploy with `prisma migrate deploy` only. Never `prisma db push` (it drops
-- the PostGIS columns that exist only in raw migration SQL).
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1. Table ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS alert_status_events (
  id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id     UUID          NOT NULL,
  from_status  "AlertStatus",
  to_status    "AlertStatus" NOT NULL,
  actor_kind   VARCHAR(16)   NOT NULL,
  actor_id     UUID,
  reason       VARCHAR(2000),
  metadata     JSONB,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ─── 2. Constraints ─────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'alert_status_events_alert_id_fkey') THEN
    ALTER TABLE alert_status_events
      ADD CONSTRAINT alert_status_events_alert_id_fkey
      FOREIGN KEY (alert_id) REFERENCES emergency_alerts(id)
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'alert_status_events_actor_kind_check') THEN
    ALTER TABLE alert_status_events
      ADD CONSTRAINT alert_status_events_actor_kind_check
      CHECK (actor_kind IN ('user', 'admin', 'system'));
  END IF;
END
$$;

-- ─── 3. Indexes ─────────────────────────────────────────────────────────────
-- Timeline of one alert, oldest first.
CREATE INDEX IF NOT EXISTS idx_alert_status_events_alert_created
  ON alert_status_events (alert_id, created_at);
-- Reporting over a period.
CREATE INDEX IF NOT EXISTS idx_alert_status_events_created
  ON alert_status_events (created_at);

COMMENT ON TABLE alert_status_events IS
  'Append-only history of emergency alert status changes. Never pruned; '
  'FK is RESTRICT so alerts with history cannot be deleted.';

-- ─── 4. Backfill existing alerts ────────────────────────────────────────────
-- For every alert that has NO history yet (so re-running inserts nothing):
--   a) the creation event at created_at ('created' for a soft alert, otherwise
--      'confirmed', which is what a manual SOS starts as);
--   b) for a soft alert that was later confirmed (by the user or by
--      auto-escalation), a created → confirmed event at confirmed_at;
--   c) if the current status differs from the last known one, a
--      current-status event timed from resolved_at / soft_alert_cancelled_at /
--      closed_at / updated_at.
-- One INSERT ... SELECT: every branch reads the same snapshot, so the
-- NOT EXISTS guard holds for all three. Backfilled rows are flagged in
-- metadata so they can be told apart from live ones.
INSERT INTO alert_status_events
  (alert_id, from_status, to_status, actor_kind, actor_id, reason, metadata, created_at)
SELECT ev.alert_id, ev.from_status, ev.to_status, ev.actor_kind, ev.actor_id, ev.reason, ev.metadata, ev.created_at
FROM (
  WITH base AS (
    SELECT
      a.id,
      a.user_id,
      a.status::text                               AS cur,
      a.is_soft_alert,
      a.created_at,
      a.confirmed_at,
      a.resolved_at,
      a.closed_at,
      a.soft_alert_cancelled_at,
      a.updated_at,
      CASE WHEN a.is_soft_alert OR a.status::text = 'created'
           THEN 'created' ELSE 'confirmed' END     AS initial_status
    FROM emergency_alerts a
    WHERE NOT EXISTS (SELECT 1 FROM alert_status_events e WHERE e.alert_id = a.id)
  ),
  shaped AS (
    SELECT b.*,
      CASE WHEN b.is_soft_alert AND b.confirmed_at IS NOT NULL AND b.initial_status = 'created'
           THEN 'confirmed' ELSE b.initial_status END AS last_known
    FROM base b
  )
  -- a) creation
  SELECT s.id AS alert_id,
         NULL::"AlertStatus"                         AS from_status,
         s.initial_status::"AlertStatus"             AS to_status,
         'user'::varchar(16)                         AS actor_kind,
         s.user_id                                   AS actor_id,
         NULL::varchar(2000)                         AS reason,
         jsonb_build_object('backfilled', true, 'event', 'created',
                            'isSoftAlert', s.is_soft_alert) AS metadata,
         s.created_at                                AS created_at
  FROM shaped s

  UNION ALL

  -- b) soft alert confirmed
  SELECT s.id,
         'created'::"AlertStatus",
         'confirmed'::"AlertStatus",
         'system'::varchar(16),
         NULL::uuid,
         NULL::varchar(2000),
         jsonb_build_object('backfilled', true, 'event', 'soft_confirmed'),
         GREATEST(s.confirmed_at, s.created_at)
  FROM shaped s
  WHERE s.last_known = 'confirmed' AND s.initial_status = 'created'

  UNION ALL

  -- c) current status, when it moved on from the last known one
  SELECT s.id,
         s.last_known::"AlertStatus",
         s.cur::"AlertStatus",
         'system'::varchar(16),
         NULL::uuid,
         NULL::varchar(2000),
         jsonb_build_object('backfilled', true, 'event', 'status_changed'),
         GREATEST(
           CASE s.cur
             WHEN 'resolved'    THEN COALESCE(s.resolved_at, s.closed_at, s.updated_at)
             WHEN 'false_alarm' THEN COALESCE(s.soft_alert_cancelled_at, s.closed_at, s.updated_at)
             WHEN 'cancelled'   THEN COALESCE(s.soft_alert_cancelled_at, s.closed_at, s.updated_at)
             ELSE COALESCE(s.closed_at, s.resolved_at, s.updated_at)
           END,
           s.confirmed_at,
           s.created_at
         )
  FROM shaped s
  WHERE s.cur <> s.last_known
) ev;

ANALYZE alert_status_events;
