-- ============================================================================
-- Retention, search indexes and query-plan visibility.
--
-- Three unrelated-looking things that share one root cause: tables that grow
-- forever, and queries that scan them.
--
--   1. Retention. alert_locations gains ~360 rows per hour of active SOS and
--      was never pruned; audit_logs and notification_logs likewise. A cleanup
--      function is provided and called by the worker daily.
--   2. Trigram indexes. Admin search uses ILIKE '%term%', which cannot use a
--      B-tree, so every search sequentially scanned users/responders/stations
--      plus a join to user_profiles.
--   3. pg_stat_statements, so the next person to ask "what is slow?" can
--      answer it from data.
--
-- Every statement is idempotent and safe to re-run.
-- ============================================================================

-- ─── 1. Extensions ──────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- ─── 2. Trigram indexes for admin search ───────────────────────────────────
-- GIN + gin_trgm_ops is what makes a leading-wildcard ILIKE index-assisted.

CREATE INDEX IF NOT EXISTS idx_users_phone_trgm
  ON users USING GIN (phone gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_users_email_trgm
  ON users USING GIN (email gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_user_profiles_full_name_trgm
  ON user_profiles USING GIN (full_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_police_stations_name_trgm
  ON police_stations USING GIN (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_police_stations_district_trgm
  ON police_stations USING GIN (district gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_responders_org_trgm
  ON responders USING GIN (organization_name gin_trgm_ops);

-- ─── 3. Supporting indexes for the analytics rewrite ───────────────────────
-- The dashboard now aggregates with date_trunc in SQL instead of pulling 30
-- days of rows into Node. These make the range scans cheap.

CREATE INDEX IF NOT EXISTS idx_alerts_created_at_brin
  ON emergency_alerts USING BRIN (created_at);

CREATE INDEX IF NOT EXISTS idx_incident_reports_created_at_brin
  ON incident_reports USING BRIN (created_at);

-- alert_locations is append-only and time-ordered: BRIN is a fraction of the
-- size of a B-tree here and is all the retention sweep needs.
CREATE INDEX IF NOT EXISTS idx_alert_locations_timestamp_brin
  ON alert_locations USING BRIN (timestamp);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at_brin
  ON audit_logs USING BRIN (created_at);

-- ─── 4. Retention ──────────────────────────────────────────────────────────
-- Deliberately conservative, and deliberately NOT a blanket delete:
--
--   * Location trails are evidence while a case is open. Only trails for
--     alerts CLOSED more than `location_days` ago are removed.
--   * audit_logs are kept far longer (a year) — they are the accountability
--     record for a system that dispatches police.
--   * notification_logs are operational, not evidential.
--
-- Deletes are chunked so the sweep never takes a long lock on a hot table.

CREATE OR REPLACE FUNCTION prune_old_records(
  location_days     INT DEFAULT 90,
  notification_days INT DEFAULT 180,
  audit_days        INT DEFAULT 365,
  batch_size        INT DEFAULT 10000
)
RETURNS TABLE(deleted_locations BIGINT, deleted_notifications BIGINT, deleted_audits BIGINT)
LANGUAGE plpgsql
AS $$
DECLARE
  loc_total   BIGINT := 0;
  notif_total BIGINT := 0;
  audit_total BIGINT := 0;
  affected    BIGINT;
BEGIN
  -- Location trails belonging to alerts closed longer ago than the cutoff.
  LOOP
    WITH doomed AS (
      SELECT al.id
      FROM alert_locations al
      JOIN emergency_alerts a ON a.id = al.alert_id
      WHERE a.closed_at IS NOT NULL
        AND a.closed_at < NOW() - (location_days || ' days')::INTERVAL
      LIMIT batch_size
    )
    DELETE FROM alert_locations al USING doomed d WHERE al.id = d.id;
    GET DIAGNOSTICS affected = ROW_COUNT;
    loc_total := loc_total + affected;
    EXIT WHEN affected = 0;
  END LOOP;

  LOOP
    WITH doomed AS (
      SELECT id FROM notification_logs
      WHERE created_at < NOW() - (notification_days || ' days')::INTERVAL
      LIMIT batch_size
    )
    DELETE FROM notification_logs n USING doomed d WHERE n.id = d.id;
    GET DIAGNOSTICS affected = ROW_COUNT;
    notif_total := notif_total + affected;
    EXIT WHEN affected = 0;
  END LOOP;

  LOOP
    WITH doomed AS (
      SELECT id FROM audit_logs
      WHERE created_at < NOW() - (audit_days || ' days')::INTERVAL
      LIMIT batch_size
    )
    DELETE FROM audit_logs a USING doomed d WHERE a.id = d.id;
    GET DIAGNOSTICS affected = ROW_COUNT;
    audit_total := audit_total + affected;
    EXIT WHEN affected = 0;
  END LOOP;

  RETURN QUERY SELECT loc_total, notif_total, audit_total;
END;
$$;

COMMENT ON FUNCTION prune_old_records IS
  'Chunked retention sweep. Called daily by the worker (plugins/worker.ts). '
  'Location trails are only removed for alerts closed beyond the cutoff, so '
  'evidence for an open case is never deleted.';

-- ─── 5. Refresh statistics ─────────────────────────────────────────────────
ANALYZE users;
ANALYZE user_profiles;
ANALYZE police_stations;
ANALYZE responders;
ANALYZE emergency_alerts;
ANALYZE incident_reports;
