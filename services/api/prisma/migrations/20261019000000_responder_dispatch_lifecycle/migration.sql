-- ════════════════════════════════════════════════════════════════════════════
-- Responder dispatch lifecycle.
--
-- responder_dispatches only had accepted_at / rejected_at, so "arrived",
-- "completed", "withdrawn" (responder cancelled their acceptance) and "closed"
-- (the SOS ended first) could not be represented, and accept/reject was an
-- unconditional UPDATE (double accepts, accept-after-reject, accept on a
-- cancelled SOS all "succeeded").
--
--   * ADDITIVE: one enum, new nullable columns + a defaulted status column,
--     one index. No existing column or row is removed.
--   * IDEMPOTENT: guarded DO block / IF NOT EXISTS; the backfill only touches
--     rows still at the default 'pending'.
--
-- Deploy with `prisma migrate deploy` only. Never `prisma db push` (it drops
-- the PostGIS columns that exist only in raw migration SQL).
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1. Enum ────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DispatchStatus') THEN
    CREATE TYPE "DispatchStatus" AS ENUM (
      'pending', 'accepted', 'arrived', 'completed', 'declined', 'withdrawn', 'closed'
    );
  END IF;
END
$$;

-- ─── 2. Columns ─────────────────────────────────────────────────────────────
ALTER TABLE responder_dispatches
  ADD COLUMN IF NOT EXISTS status          "DispatchStatus" NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS arrived_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS withdrawn_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS closed_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS distance_meters INTEGER;

-- ─── 3. Backfill existing rows from the old timestamps ──────────────────────
UPDATE responder_dispatches
   SET status = 'declined'
 WHERE status = 'pending' AND rejected_at IS NOT NULL;

UPDATE responder_dispatches
   SET status = 'accepted'
 WHERE status = 'pending' AND accepted_at IS NOT NULL;

-- Dispatches whose SOS has already ended are closed, not open.
UPDATE responder_dispatches d
   SET status = 'closed', closed_at = COALESCE(a.closed_at, a.resolved_at, NOW())
  FROM emergency_alerts a
 WHERE a.id = d.alert_id
   AND d.status IN ('pending', 'accepted')
   AND a.status NOT IN ('created', 'confirmed', 'notified_contacts', 'in_progress');

-- A user must never be dispatched to their own SOS (the fan-out did not
-- exclude the alert owner). Close any such rows that are still open.
UPDATE responder_dispatches d
   SET status = 'closed', closed_at = NOW()
  FROM responders r, emergency_alerts a
 WHERE r.id = d.responder_id
   AND a.id = d.alert_id
   AND r.user_id = a.user_id
   AND d.status IN ('pending', 'accepted');

-- ─── 4. Index: "my open dispatches" ─────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_responder_dispatches_responder_status
  ON responder_dispatches (responder_id, status);
