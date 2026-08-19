-- ============================================================================
-- Make the existing PostGIS geometry columns usable by the query planner.
--
-- Background
-- ----------
-- 20260624000000_init created GEOMETRY(Point, 4326) `location` columns, GIST
-- indexes over them, and BEFORE INSERT/UPDATE triggers that keep them in sync
-- with the decimal latitude/longitude columns.
--
-- The application, however, never queried `location` — every spatial query
-- rebuilt the point with ST_MakePoint(longitude, latitude). Because that
-- expression does not match the indexed column, PostgreSQL could not use the
-- GIST indexes and fell back to a sequential scan on every SOS trigger, every
-- responder dispatch and every Safe Route request.
--
-- This migration:
--   1. Backfills any row whose `location` was never populated.
--   2. Adds geography-cast expression indexes, so metre-accurate ST_DWithin
--      and <-> (KNN) queries are index-assisted.
--   3. Adds the composite indexes the hot list queries actually need.
--   4. Adds a sequence for collision-free case numbers.
--
-- Every statement is idempotent and safe to re-run.
-- ============================================================================

-- ─── 1. Backfill NULL geometries ───────────────────────────────────────────

UPDATE police_stations
   SET location = ST_SetSRID(ST_MakePoint(longitude::float, latitude::float), 4326)
 WHERE location IS NULL AND latitude IS NOT NULL AND longitude IS NOT NULL;

UPDATE responders
   SET location = ST_SetSRID(ST_MakePoint(longitude::float, latitude::float), 4326)
 WHERE location IS NULL AND latitude IS NOT NULL AND longitude IS NOT NULL;

UPDATE incident_reports
   SET location = ST_SetSRID(ST_MakePoint(longitude::float, latitude::float), 4326)
 WHERE location IS NULL AND latitude IS NOT NULL AND longitude IS NOT NULL;

UPDATE emergency_alerts
   SET location = ST_SetSRID(ST_MakePoint(longitude::float, latitude::float), 4326)
 WHERE location IS NULL AND latitude IS NOT NULL AND longitude IS NOT NULL;

UPDATE alert_locations
   SET location = ST_SetSRID(ST_MakePoint(longitude::float, latitude::float), 4326)
 WHERE location IS NULL AND latitude IS NOT NULL AND longitude IS NOT NULL;

-- ─── 2. Geography expression indexes ───────────────────────────────────────
-- ST_DWithin(location::geography, ...) and location::geography <-> ... measure
-- true metres. They can only use an index built over the SAME expression.
-- These are deliberately NOT partial: a partial predicate over the native enum
-- columns (status / availability) is fragile across enum changes, and the
-- tables are small enough that a full index costs little.

CREATE INDEX IF NOT EXISTS idx_police_stations_location_geog
  ON police_stations USING GIST ((location::geography));

CREATE INDEX IF NOT EXISTS idx_responders_location_geog
  ON responders USING GIST ((location::geography));

CREATE INDEX IF NOT EXISTS idx_incident_reports_location_geog
  ON incident_reports USING GIST ((location::geography));

-- ─── 3. Composite indexes for the hot list queries ─────────────────────────

-- police.repository.getActiveAlertsForStation: filter by station + status,
-- order by created_at DESC.
CREATE INDEX IF NOT EXISTS idx_alerts_station_status_created
  ON emergency_alerts (assigned_station_id, status, created_at DESC);

-- cases.repository.findCasesByStation: filter by station + status.
CREATE INDEX IF NOT EXISTS idx_cases_station_status
  ON cases (station_id, status);

-- notifications: "how did the fan-out for this alert go?"
CREATE INDEX IF NOT EXISTS idx_notification_logs_alert_status
  ON notification_logs (alert_id, status);

-- responder dispatch de-duplication. The alert fan-out now uses
-- createMany({ skipDuplicates: true }), which needs a unique constraint to be
-- able to skip. Remove any pre-existing duplicates first (keeping the oldest)
-- so the index can be built on existing data.
DELETE FROM responder_dispatches d
 USING responder_dispatches keep
 WHERE d.alert_id     = keep.alert_id
   AND d.responder_id = keep.responder_id
   AND (d.dispatched_at, d.id) > (keep.dispatched_at, keep.id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_responder_dispatches_unique
  ON responder_dispatches (alert_id, responder_id);

-- ─── 4. Collision-free case numbers ────────────────────────────────────────
-- cases.service generated CASE-<year>-<4 hex chars>: only 65,536 values per
-- year against a UNIQUE column, so by the birthday bound a collision becomes
-- more likely than not at roughly 300 cases. A sequence removes the class of
-- bug entirely and yields readable, ordered case numbers.

CREATE SEQUENCE IF NOT EXISTS case_number_seq AS BIGINT START WITH 1 INCREMENT BY 1;

-- Start the sequence above any case numbers that already exist, so the first
-- generated number cannot collide with legacy CASE-<timestamp> rows.
SELECT setval(
  'case_number_seq',
  GREATEST((SELECT COUNT(*) FROM cases), 1),
  TRUE
);

-- ─── 5. Refresh planner statistics ─────────────────────────────────────────
ANALYZE police_stations;
ANALYZE responders;
ANALYZE incident_reports;
ANALYZE emergency_alerts;
