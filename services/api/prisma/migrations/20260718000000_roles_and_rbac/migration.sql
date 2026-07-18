-- ============================================================
-- Roles & RBAC — brings migrations in sync with schema.prisma
--
-- The Role model and users.role_id existed in schema.prisma but were
-- never captured in a migration, which broke fresh deploys
-- (`prisma migrate deploy` → seed failed on missing public.roles).
--
-- Written idempotently (IF NOT EXISTS guards) so it is a no-op on
-- databases that were already patched by hand.
-- ============================================================

-- ─── Roles table ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "roles" (
    "id"          UUID NOT NULL DEFAULT gen_random_uuid(),
    "name"        VARCHAR(100) NOT NULL,
    "key"         VARCHAR(50)  NOT NULL,
    "description" VARCHAR(500),
    "is_system"   BOOLEAN NOT NULL DEFAULT false,
    "created_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "roles_key_key" ON "roles"("key");
CREATE INDEX IF NOT EXISTS "roles_key_idx" ON "roles"("key");

-- ─── users.role_id → roles.id ──────────────────────────────
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "role_id" UUID;

CREATE INDEX IF NOT EXISTS "users_role_id_idx" ON "users"("role_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_role_id_fkey'
  ) THEN
    ALTER TABLE "users" ADD CONSTRAINT "users_role_id_fkey"
      FOREIGN KEY ("role_id") REFERENCES "roles"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
