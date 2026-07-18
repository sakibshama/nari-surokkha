-- ============================================================
-- Native Postgres enums — syncs DB with schema.prisma
--
-- The original raw-SQL migrations created VARCHAR + CHECK columns,
-- but schema.prisma declares native enums, and the generated Prisma
-- client casts every write to those enum types
-- (e.g. $1::"public"."PoliceUserRole"). On a pure-migrations database
-- those types don't exist and ALL writes to these columns fail.
--
-- This migration creates each enum type and converts the columns.
-- Fully idempotent: types are created only if absent, columns are
-- converted only if still varchar/text.
-- ============================================================

-- ─── 1. Create enum types (if absent) ───────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE t.typname='UserStatus' AND n.nspname='public') THEN
    CREATE TYPE "UserStatus" AS ENUM ('active','inactive','suspended','pending_verification');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE t.typname='AlertStatus' AND n.nspname='public') THEN
    CREATE TYPE "AlertStatus" AS ENUM ('created','confirmed','notified_contacts','sent_to_police','acknowledged_by_police','in_progress','resolved','cancelled','false_alarm','closed');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE t.typname='AlertType' AND n.nspname='public') THEN
    CREATE TYPE "AlertType" AS ENUM ('manual','sensor_triggered','ml_triggered');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE t.typname='EvidenceType' AND n.nspname='public') THEN
    CREATE TYPE "EvidenceType" AS ENUM ('photo','audio','video','document');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE t.typname='ResponderStatus' AND n.nspname='public') THEN
    CREATE TYPE "ResponderStatus" AS ENUM ('pending','verified','rejected','suspended');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE t.typname='ResponderAvailability' AND n.nspname='public') THEN
    CREATE TYPE "ResponderAvailability" AS ENUM ('available','busy','offline');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE t.typname='PoliceUserRole' AND n.nspname='public') THEN
    CREATE TYPE "PoliceUserRole" AS ENUM ('officer','supervisor','admin');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE t.typname='CaseStatus' AND n.nspname='public') THEN
    CREATE TYPE "CaseStatus" AS ENUM ('open','assigned','in_progress','resolved','closed','false_alarm');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE t.typname='NotificationChannel' AND n.nspname='public') THEN
    CREATE TYPE "NotificationChannel" AS ENUM ('sms','push','email');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE t.typname='NotificationStatus' AND n.nspname='public') THEN
    CREATE TYPE "NotificationStatus" AS ENUM ('queued','sent','failed','delivered');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE t.typname='MlDetectionType' AND n.nspname='public') THEN
    CREATE TYPE "MlDetectionType" AS ENUM ('fall','struggle_motion','distress_audio','trigger_word');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE t.typname='IncidentType' AND n.nspname='public') THEN
    CREATE TYPE "IncidentType" AS ENUM ('harassment','robbery','suspicious_activity','poor_lighting','other');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE t.typname='IncidentStatus' AND n.nspname='public') THEN
    CREATE TYPE "IncidentStatus" AS ENUM ('pending','verified','rejected');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE t.typname='AuditAction' AND n.nspname='public') THEN
    CREATE TYPE "AuditAction" AS ENUM ('created','updated','deleted','login','logout','sos_triggered','alert_acknowledged','case_assigned','case_closed','evidence_accessed','evidence_uploaded','responder_approved','responder_rejected');
  END IF;
END $$;

-- ─── 2. Convert columns (only if still varchar/text) ────────
-- helper pattern: drop CHECK, drop default, alter type, restore default

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('users',              'status',          'UserStatus',            'active'),
    ('police_users',       'role',            'PoliceUserRole',        'officer'),
    ('emergency_alerts',   'type',            'AlertType',             'manual'),
    ('emergency_alerts',   'status',          'AlertStatus',           'created'),
    ('alert_evidence',     'type',            'EvidenceType',          NULL),
    ('responders',         'status',          'ResponderStatus',       'pending'),
    ('responders',         'availability',    'ResponderAvailability', 'offline'),
    ('cases',              'status',          'CaseStatus',            'open'),
    ('case_updates',       'previous_status', 'CaseStatus',            NULL),
    ('case_updates',       'new_status',      'CaseStatus',            NULL),
    ('notification_logs',  'channel',         'NotificationChannel',   NULL),
    ('notification_logs',  'status',          'NotificationStatus',    'queued'),
    ('ml_detection_events','detection_type',  'MlDetectionType',       NULL),
    ('incident_reports',   'type',            'IncidentType',          NULL),
    ('incident_reports',   'status',          'IncidentStatus',        'pending'),
    ('audit_logs',         'action',          'AuditAction',           NULL)
  ) AS t(tbl, col, enum_name, default_val)
  LOOP
    -- only convert when the column exists and is not already the enum
    IF EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema='public' AND c.table_name=r.tbl AND c.column_name=r.col
        AND c.udt_name IN ('varchar','text','bpchar')
    ) THEN
      -- drop the legacy CHECK constraint if present (auto-named)
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', r.tbl, r.tbl || '_' || r.col || '_check');
      -- drop default before type change
      EXECUTE format('ALTER TABLE %I ALTER COLUMN %I DROP DEFAULT', r.tbl, r.col);
      -- convert
      EXECUTE format('ALTER TABLE %I ALTER COLUMN %I TYPE %I USING %I::text::%I', r.tbl, r.col, r.enum_name, r.col, r.enum_name);
      -- restore default
      IF r.default_val IS NOT NULL THEN
        EXECUTE format('ALTER TABLE %I ALTER COLUMN %I SET DEFAULT %L::%I', r.tbl, r.col, r.default_val, r.enum_name);
      END IF;
    END IF;
  END LOOP;
END $$;
