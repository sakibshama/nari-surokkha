-- ============================================================
-- Subscriptions and payments (SSLCommerz / Stripe, configured in the Admin
-- Portal under the `payment_gateways` system setting).
--
-- The Subscription and Payment models were added to schema.prisma without a
-- migration, so `migrate deploy` never created these tables. This migration
-- creates them, plus the gateway columns used by the dynamic gateways.
--
-- Idempotent: every statement is guarded (same convention as the others).
-- NEVER use `prisma db push` on this database (it drops PostGIS columns).
-- ============================================================

CREATE TABLE IF NOT EXISTS subscriptions (
    id             UUID         NOT NULL DEFAULT gen_random_uuid(),
    user_id        UUID         NOT NULL,
    status         TEXT         NOT NULL DEFAULT 'inactive',
    plan_id        TEXT         NOT NULL DEFAULT 'monthly_50',
    start_date     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    end_date       TIMESTAMPTZ  NOT NULL,
    sms_remaining  INTEGER      NOT NULL DEFAULT 0,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT subscriptions_pkey PRIMARY KEY (id)
);
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_user_id_key ON subscriptions(user_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscriptions_user_id_fkey') THEN
    ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS payments (
    id                  UUID           NOT NULL DEFAULT gen_random_uuid(),
    user_id             UUID           NOT NULL,
    subscription_id     UUID,
    amount              DECIMAL(10,2)  NOT NULL,
    currency            VARCHAR(10)    NOT NULL DEFAULT 'BDT',
    status              TEXT           NOT NULL DEFAULT 'pending',
    transaction_id      VARCHAR(100)   NOT NULL,
    gateway_trx_id      VARCHAR(100),
    payment_method      VARCHAR(50),
    created_at          TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    CONSTRAINT payments_pkey PRIMARY KEY (id)
);
-- Columns for admin-managed gateways (added separately so a database that
-- already has an older `payments` table gets them too).
ALTER TABLE payments ADD COLUMN IF NOT EXISTS plan_id            VARCHAR(40);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS gateway_id         VARCHAR(60);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS gateway_type       VARCHAR(20);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS gateway_session_id VARCHAR(255);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS failure_reason     VARCHAR(255);

CREATE UNIQUE INDEX IF NOT EXISTS payments_transaction_id_key ON payments(transaction_id);
CREATE INDEX IF NOT EXISTS payments_user_id_idx ON payments(user_id);
CREATE INDEX IF NOT EXISTS payments_transaction_id_idx ON payments(transaction_id);
CREATE INDEX IF NOT EXISTS payments_status_created_at_idx ON payments(status, created_at);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_user_id_fkey') THEN
    ALTER TABLE payments ADD CONSTRAINT payments_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_subscription_id_fkey') THEN
    ALTER TABLE payments ADD CONSTRAINT payments_subscription_id_fkey
      FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
