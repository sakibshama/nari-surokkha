-- ============================================================
-- Nari Surokkha — Initial Migration
-- Phase 3: Full database schema
--
-- IMPORTANT:
-- This migration enables PostGIS and adds geometry columns
-- that Prisma cannot express natively.
-- Run via: npx prisma migrate dev --name init
-- ============================================================

-- Enable PostGIS extension
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─── Users & Auth ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone         VARCHAR(20)  NOT NULL UNIQUE,
  email         VARCHAR(255) UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role          TEXT         NOT NULL DEFAULT 'citizen'
                CHECK (role IN ('citizen','responder','police','admin')),
  status        TEXT         NOT NULL DEFAULT 'active'
                CHECK (status IN ('active','inactive','suspended','pending_verification')),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_phone      ON users(phone);
CREATE INDEX idx_users_email      ON users(email) WHERE email IS NOT NULL;
CREATE INDEX idx_users_role       ON users(role);
CREATE INDEX idx_users_status     ON users(status);
CREATE INDEX idx_users_created_at ON users(created_at DESC);

-- ─── User Profiles ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_profiles (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID         NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  full_name          VARCHAR(100) NOT NULL,
  blood_group        VARCHAR(5),
  preferred_language VARCHAR(5)   NOT NULL DEFAULT 'bn',
  emergency_note     VARCHAR(500),
  national_id        VARCHAR(20),
  profile_photo_key  VARCHAR(500),
  is_verified        BOOLEAN      NOT NULL DEFAULT FALSE,
  verified_at        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_profiles_user_id ON user_profiles(user_id);

-- ─── User Sessions ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token VARCHAR(512) NOT NULL UNIQUE,
  device_info   VARCHAR(500),
  ip_address    VARCHAR(50),
  expires_at    TIMESTAMPTZ  NOT NULL,
  revoked_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_sessions_user_id       ON user_sessions(user_id);
CREATE INDEX idx_user_sessions_refresh_token ON user_sessions(refresh_token);
CREATE INDEX idx_user_sessions_expires_at    ON user_sessions(expires_at);

-- ─── Device Tokens ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS device_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      VARCHAR(512) NOT NULL,
  platform   VARCHAR(10)  NOT NULL CHECK (platform IN ('android', 'ios')),
  is_active  BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, token)
);

CREATE INDEX idx_device_tokens_user_id ON device_tokens(user_id);
CREATE INDEX idx_device_tokens_token   ON device_tokens(token) WHERE is_active = TRUE;

-- ─── Trusted Contacts ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS trusted_contacts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        VARCHAR(100) NOT NULL,
  phone       VARCHAR(20)  NOT NULL,
  relation    VARCHAR(50),
  is_primary  BOOLEAN      NOT NULL DEFAULT FALSE,
  is_verified BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_trusted_contacts_user_id ON trusted_contacts(user_id);
CREATE INDEX idx_trusted_contacts_phone   ON trusted_contacts(phone);

-- ─── Police Stations ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS police_stations (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       VARCHAR(200)    NOT NULL,
  thana_code VARCHAR(20)     NOT NULL UNIQUE,
  district   VARCHAR(100)    NOT NULL,
  division   VARCHAR(100)    NOT NULL,
  address    VARCHAR(500),
  phone      VARCHAR(20)     NOT NULL,
  is_active  BOOLEAN         NOT NULL DEFAULT TRUE,
  latitude   DECIMAL(10, 8)  NOT NULL,
  longitude  DECIMAL(11, 8)  NOT NULL,
  -- PostGIS geometry column for fast spatial queries
  location   GEOMETRY(Point, 4326),
  created_at TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_police_stations_thana_code ON police_stations(thana_code);
CREATE INDEX idx_police_stations_district   ON police_stations(district);
CREATE INDEX idx_police_stations_active     ON police_stations(is_active) WHERE is_active = TRUE;
-- Geospatial index (GIST) for nearest-station queries
CREATE INDEX idx_police_stations_location ON police_stations USING GIST(location);

-- Trigger: keep location column in sync with lat/lng
CREATE OR REPLACE FUNCTION sync_police_station_location()
RETURNS TRIGGER AS $$
BEGIN
  NEW.location := ST_SetSRID(ST_MakePoint(NEW.longitude::FLOAT, NEW.latitude::FLOAT), 4326);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_police_station_location
  BEFORE INSERT OR UPDATE OF latitude, longitude ON police_stations
  FOR EACH ROW EXECUTE FUNCTION sync_police_station_location();

-- ─── Police Users ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS police_users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id    UUID         NOT NULL REFERENCES police_stations(id),
  badge_number  VARCHAR(50)  NOT NULL UNIQUE,
  full_name     VARCHAR(100) NOT NULL,
  phone         VARCHAR(20)  NOT NULL,
  email         VARCHAR(255) UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role          TEXT         NOT NULL DEFAULT 'officer'
                CHECK (role IN ('officer','supervisor','admin')),
  is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_police_users_station_id   ON police_users(station_id);
CREATE INDEX idx_police_users_badge_number ON police_users(badge_number);
CREATE INDEX idx_police_users_email        ON police_users(email) WHERE email IS NOT NULL;

-- ─── Emergency Alerts ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS emergency_alerts (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                   UUID           NOT NULL REFERENCES users(id),
  type                      TEXT           NOT NULL DEFAULT 'manual'
                            CHECK (type IN ('manual','sensor_triggered','ml_triggered')),
  status                    TEXT           NOT NULL DEFAULT 'created'
                            CHECK (status IN (
                              'created','confirmed','notified_contacts','sent_to_police',
                              'acknowledged_by_police','in_progress','resolved',
                              'cancelled','false_alarm','closed'
                            )),
  latitude                  DECIMAL(10, 8) NOT NULL,
  longitude                 DECIMAL(11, 8) NOT NULL,
  accuracy                  DECIMAL(8, 2),
  location                  GEOMETRY(Point, 4326),
  assigned_station_id       UUID REFERENCES police_stations(id),
  ml_metadata               JSONB,
  is_soft_alert             BOOLEAN        NOT NULL DEFAULT FALSE,
  soft_alert_at             TIMESTAMPTZ,
  soft_alert_cancelled_at   TIMESTAMPTZ,
  confirmed_at              TIMESTAMPTZ,
  resolved_at               TIMESTAMPTZ,
  closed_at                 TIMESTAMPTZ,
  created_at                TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_alerts_user_id           ON emergency_alerts(user_id);
CREATE INDEX idx_alerts_status            ON emergency_alerts(status);
CREATE INDEX idx_alerts_type              ON emergency_alerts(type);
CREATE INDEX idx_alerts_created_at        ON emergency_alerts(created_at DESC);
CREATE INDEX idx_alerts_station_id        ON emergency_alerts(assigned_station_id);
-- Active alerts only index (most common query)
CREATE INDEX idx_alerts_active            ON emergency_alerts(user_id, status)
  WHERE status NOT IN ('closed', 'cancelled', 'false_alarm', 'resolved');
CREATE INDEX idx_alerts_location          ON emergency_alerts USING GIST(location);

CREATE OR REPLACE FUNCTION sync_alert_location()
RETURNS TRIGGER AS $$
BEGIN
  NEW.location := ST_SetSRID(ST_MakePoint(NEW.longitude::FLOAT, NEW.latitude::FLOAT), 4326);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_alert_location
  BEFORE INSERT OR UPDATE OF latitude, longitude ON emergency_alerts
  FOR EACH ROW EXECUTE FUNCTION sync_alert_location();

-- ─── Alert Locations (live tracking) ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS alert_locations (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id  UUID           NOT NULL REFERENCES emergency_alerts(id) ON DELETE CASCADE,
  latitude  DECIMAL(10, 8) NOT NULL,
  longitude DECIMAL(11, 8) NOT NULL,
  accuracy  DECIMAL(8, 2),
  location  GEOMETRY(Point, 4326),
  timestamp TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

-- Optimized for high-frequency timeline queries
CREATE INDEX idx_alert_locations_alert_id_ts ON alert_locations(alert_id, timestamp DESC);
CREATE INDEX idx_alert_locations_location    ON alert_locations USING GIST(location);

CREATE TRIGGER trg_sync_alert_location_point
  BEFORE INSERT ON alert_locations
  FOR EACH ROW EXECUTE FUNCTION sync_alert_location();

-- Override trigger function to use different table columns
CREATE OR REPLACE FUNCTION sync_alert_loc_point()
RETURNS TRIGGER AS $$
BEGIN
  NEW.location := ST_SetSRID(ST_MakePoint(NEW.longitude::FLOAT, NEW.latitude::FLOAT), 4326);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_alert_location_point ON alert_locations;
CREATE TRIGGER trg_sync_alert_location_point
  BEFORE INSERT OR UPDATE OF latitude, longitude ON alert_locations
  FOR EACH ROW EXECUTE FUNCTION sync_alert_loc_point();

-- ─── Alert Evidence ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS alert_evidence (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id      UUID         NOT NULL REFERENCES emergency_alerts(id) ON DELETE CASCADE,
  type          TEXT         NOT NULL CHECK (type IN ('photo','audio','video','document')),
  file_key      VARCHAR(1000) NOT NULL,
  original_name VARCHAR(255)  NOT NULL,
  mime_type     VARCHAR(100)  NOT NULL,
  size_bytes    BIGINT        NOT NULL,
  checksum      VARCHAR(64)   NOT NULL,
  uploaded_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_evidence_alert_id    ON alert_evidence(alert_id);
CREATE INDEX idx_evidence_uploaded_at ON alert_evidence(uploaded_at DESC);

-- ─── Evidence Access Logs ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS evidence_access_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_id  UUID        NOT NULL REFERENCES alert_evidence(id) ON DELETE CASCADE,
  accessed_by  VARCHAR(100) NOT NULL,
  accessed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_address   VARCHAR(50)
);

CREATE INDEX idx_evidence_access_evidence_id ON evidence_access_logs(evidence_id);
CREATE INDEX idx_evidence_access_accessed_at ON evidence_access_logs(accessed_at DESC);

-- ─── Alert Recipients ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS alert_recipients (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id           UUID        NOT NULL REFERENCES emergency_alerts(id) ON DELETE CASCADE,
  trusted_contact_id UUID REFERENCES trusted_contacts(id),
  police_station_id  UUID REFERENCES police_stations(id),
  notified_at        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_alert_recipients_alert_id          ON alert_recipients(alert_id);
CREATE INDEX idx_alert_recipients_trusted_contact   ON alert_recipients(trusted_contact_id);
CREATE INDEX idx_alert_recipients_police_station    ON alert_recipients(police_station_id);

-- ─── Responders ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS responders (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID           NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  status            TEXT           NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','verified','rejected','suspended')),
  availability      TEXT           NOT NULL DEFAULT 'offline'
                    CHECK (availability IN ('available','busy','offline')),
  national_id       VARCHAR(20),
  occupation        VARCHAR(100),
  organization_name VARCHAR(100),
  latitude          DECIMAL(10, 8),
  longitude         DECIMAL(11, 8),
  location          GEOMETRY(Point, 4326),
  last_location_at  TIMESTAMPTZ,
  approved_at       TIMESTAMPTZ,
  approved_by       UUID,
  created_at        TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_responders_user_id     ON responders(user_id);
CREATE INDEX idx_responders_status      ON responders(status);
CREATE INDEX idx_responders_availability ON responders(availability)
  WHERE status = 'verified';
CREATE INDEX idx_responders_location    ON responders USING GIST(location)
  WHERE status = 'verified' AND availability = 'available';

CREATE OR REPLACE FUNCTION sync_responder_location()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL THEN
    NEW.location := ST_SetSRID(ST_MakePoint(NEW.longitude::FLOAT, NEW.latitude::FLOAT), 4326);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_responder_location
  BEFORE INSERT OR UPDATE OF latitude, longitude ON responders
  FOR EACH ROW EXECUTE FUNCTION sync_responder_location();

-- ─── Responder Verifications ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS responder_verifications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  responder_id  UUID         NOT NULL REFERENCES responders(id) ON DELETE CASCADE,
  document_key  VARCHAR(1000) NOT NULL,
  document_type VARCHAR(50)  NOT NULL,
  uploaded_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_responder_verifications_responder_id ON responder_verifications(responder_id);

-- ─── Responder Dispatches ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS responder_dispatches (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  responder_id  UUID         NOT NULL REFERENCES responders(id),
  alert_id      UUID         NOT NULL REFERENCES emergency_alerts(id),
  dispatched_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  accepted_at   TIMESTAMPTZ,
  rejected_at   TIMESTAMPTZ,
  reject_reason VARCHAR(255)
);

CREATE INDEX idx_responder_dispatches_responder ON responder_dispatches(responder_id);
CREATE INDEX idx_responder_dispatches_alert     ON responder_dispatches(alert_id);

-- ─── Cases ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS cases (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id            UUID        NOT NULL REFERENCES emergency_alerts(id),
  station_id          UUID        NOT NULL REFERENCES police_stations(id),
  case_number         VARCHAR(50) NOT NULL UNIQUE,
  status              TEXT        NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open','assigned','in_progress','resolved','closed','false_alarm')),
  assigned_officer_id UUID REFERENCES police_users(id),
  summary             VARCHAR(2000),
  closed_at           TIMESTAMPTZ,
  closed_reason       VARCHAR(500),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cases_alert_id          ON cases(alert_id);
CREATE INDEX idx_cases_station_id        ON cases(station_id);
CREATE INDEX idx_cases_status            ON cases(status);
CREATE INDEX idx_cases_assigned_officer  ON cases(assigned_officer_id);
CREATE INDEX idx_cases_created_at        ON cases(created_at DESC);

-- ─── Case Updates ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS case_updates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id         UUID        NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  officer_id      UUID        NOT NULL REFERENCES police_users(id),
  previous_status TEXT,
  new_status      TEXT,
  note            VARCHAR(2000),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_case_updates_case_id    ON case_updates(case_id);
CREATE INDEX idx_case_updates_officer_id ON case_updates(officer_id);
CREATE INDEX idx_case_updates_created_at ON case_updates(created_at DESC);

-- ─── Notification Logs ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notification_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id     UUID        REFERENCES emergency_alerts(id),
  channel      TEXT        NOT NULL CHECK (channel IN ('sms','push','email')),
  recipient    VARCHAR(255) NOT NULL,
  message      VARCHAR(1000) NOT NULL,
  status       TEXT        NOT NULL DEFAULT 'queued'
               CHECK (status IN ('queued','sent','failed','delivered')),
  attempts     INTEGER     NOT NULL DEFAULT 0,
  last_error   VARCHAR(500),
  sent_at      TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notification_logs_alert_id   ON notification_logs(alert_id);
CREATE INDEX idx_notification_logs_channel    ON notification_logs(channel);
CREATE INDEX idx_notification_logs_status     ON notification_logs(status)
  WHERE status IN ('queued','failed');
CREATE INDEX idx_notification_logs_created_at ON notification_logs(created_at DESC);

-- ─── ML Detection Events ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ml_detection_events (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID           NOT NULL REFERENCES users(id),
  alert_id              UUID REFERENCES emergency_alerts(id),
  detection_type        TEXT           NOT NULL
                        CHECK (detection_type IN ('fall','struggle_motion','distress_audio','trigger_word')),
  confidence            DECIMAL(5, 4)  NOT NULL,
  raw_metadata          JSONB,
  triggered_soft_alert  BOOLEAN        NOT NULL DEFAULT FALSE,
  soft_alert_cancelled  BOOLEAN        NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ml_events_user_id        ON ml_detection_events(user_id);
CREATE INDEX idx_ml_events_alert_id       ON ml_detection_events(alert_id);
CREATE INDEX idx_ml_events_detection_type ON ml_detection_events(detection_type);
CREATE INDEX idx_ml_events_created_at     ON ml_detection_events(created_at DESC);

-- ─── Incident Reports ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS incident_reports (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID REFERENCES users(id),
  type        TEXT        NOT NULL
              CHECK (type IN ('harassment','assault','stalking','unsafe_area','other')),
  latitude    DECIMAL(10, 8) NOT NULL,
  longitude   DECIMAL(11, 8) NOT NULL,
  location    GEOMETRY(Point, 4326),
  description VARCHAR(1000),
  is_anonymous BOOLEAN    NOT NULL DEFAULT TRUE,
  is_reviewed BOOLEAN     NOT NULL DEFAULT FALSE,
  is_approved BOOLEAN     NOT NULL DEFAULT FALSE,
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_incident_reports_reporter  ON incident_reports(reporter_id) WHERE reporter_id IS NOT NULL;
CREATE INDEX idx_incident_reports_type      ON incident_reports(type);
CREATE INDEX idx_incident_reports_approved  ON incident_reports(is_approved);
CREATE INDEX idx_incident_reports_created   ON incident_reports(created_at DESC);
CREATE INDEX idx_incident_reports_location  ON incident_reports USING GIST(location);

CREATE OR REPLACE FUNCTION sync_incident_location()
RETURNS TRIGGER AS $$
BEGIN
  NEW.location := ST_SetSRID(ST_MakePoint(NEW.longitude::FLOAT, NEW.latitude::FLOAT), 4326);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_incident_location
  BEFORE INSERT OR UPDATE OF latitude, longitude ON incident_reports
  FOR EACH ROW EXECUTE FUNCTION sync_incident_location();

-- ─── Safety Scores ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS safety_scores (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  area_key       VARCHAR(100)   NOT NULL UNIQUE,
  center_lat     DECIMAL(10, 8) NOT NULL,
  center_lng     DECIMAL(11, 8) NOT NULL,
  center_point   GEOMETRY(Point, 4326),
  radius_meters  INTEGER        NOT NULL,
  score          INTEGER        NOT NULL CHECK (score BETWEEN 0 AND 100),
  incident_count INTEGER        NOT NULL DEFAULT 0,
  alert_count    INTEGER        NOT NULL DEFAULT 0,
  calculated_at  TIMESTAMPTZ    NOT NULL,
  expires_at     TIMESTAMPTZ    NOT NULL
);

CREATE INDEX idx_safety_scores_area_key      ON safety_scores(area_key);
CREATE INDEX idx_safety_scores_calculated_at ON safety_scores(calculated_at DESC);
CREATE INDEX idx_safety_scores_center_point  ON safety_scores USING GIST(center_point);

-- ─── Audit Logs (append-only) ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS audit_logs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID REFERENCES users(id),
  police_user_id UUID REFERENCES police_users(id),
  action         TEXT        NOT NULL,
  entity_type    VARCHAR(50) NOT NULL,
  entity_id      UUID,
  ip_address     VARCHAR(50),
  user_agent     VARCHAR(500),
  metadata       JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_user_id        ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_police_user_id ON audit_logs(police_user_id);
CREATE INDEX idx_audit_logs_action         ON audit_logs(action);
CREATE INDEX idx_audit_logs_entity         ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_logs_created_at     ON audit_logs(created_at DESC);

-- Prevent modification of audit logs (true append-only)
CREATE OR REPLACE RULE audit_logs_no_update AS
  ON UPDATE TO audit_logs DO INSTEAD NOTHING;
CREATE OR REPLACE RULE audit_logs_no_delete AS
  ON DELETE TO audit_logs DO INSTEAD NOTHING;

-- ─── updated_at auto-trigger ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to all tables with updated_at
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users', 'user_profiles', 'device_tokens', 'trusted_contacts',
    'police_stations', 'police_users', 'emergency_alerts',
    'responders', 'cases', 'notification_logs'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER trg_updated_at_%s
       BEFORE UPDATE ON %s
       FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()',
      t, t
    );
  END LOOP;
END;
$$;
