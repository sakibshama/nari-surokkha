-- ============================================================
-- Schema parity — final drift closure between schema.prisma and
-- the hand-written migrations. Produced from a full programmatic
-- diff of every model field vs every CREATE/ALTER TABLE statement.
--
-- Missing pieces closed here:
--   users.permissions                (RBAC — used by auth + seed)
--   responders.reputation_score
--   responders.badges
--   responder_dispatches.verified_at
--   responder_dispatches.verified_by
--   incident_reports.status         (IncidentStatus enum)
--   incident_reports.updated_at
--   "ActiveRoute" table             (safe-route feature; model has
--                                    no @@map, so the exact quoted
--                                    name is required)
--
-- Idempotent: every statement is guarded.
-- ============================================================

-- ─── users ──────────────────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions TEXT[] NOT NULL DEFAULT '{}';

-- ─── responders ─────────────────────────────────────────────
ALTER TABLE responders ADD COLUMN IF NOT EXISTS reputation_score INTEGER NOT NULL DEFAULT 0;
ALTER TABLE responders ADD COLUMN IF NOT EXISTS badges TEXT[] NOT NULL DEFAULT '{}';

-- ─── responder_dispatches ───────────────────────────────────
ALTER TABLE responder_dispatches ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;
ALTER TABLE responder_dispatches ADD COLUMN IF NOT EXISTS verified_by UUID;

-- ─── incident_reports ───────────────────────────────────────
ALTER TABLE incident_reports ADD COLUMN IF NOT EXISTS status "IncidentStatus" NOT NULL DEFAULT 'pending';
ALTER TABLE incident_reports ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
CREATE INDEX IF NOT EXISTS idx_incident_reports_status ON incident_reports(status);

-- ─── ActiveRoute (safe-route tracking) ──────────────────────
CREATE TABLE IF NOT EXISTS "ActiveRoute" (
    "id"          UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id"     UUID NOT NULL,
    "origin_lat"  DECIMAL(10,8) NOT NULL,
    "origin_lng"  DECIMAL(10,8) NOT NULL,
    "dest_lat"    DECIMAL(10,8) NOT NULL,
    "dest_lng"    DECIMAL(10,8) NOT NULL,
    "waypoints"   JSONB NOT NULL,
    "status"      VARCHAR(50) NOT NULL DEFAULT 'active',
    "created_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "ActiveRoute_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ActiveRoute_user_id_idx" ON "ActiveRoute"("user_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ActiveRoute_user_id_fkey') THEN
    ALTER TABLE "ActiveRoute" ADD CONSTRAINT "ActiveRoute_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
