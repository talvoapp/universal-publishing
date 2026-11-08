-- ============================================================
-- Wallet Service — Initial Schema
-- Double-entry ledger + payouts
-- ============================================================

BEGIN;

-- Required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ------------------------------------------------------------
-- LEDGER TRANSACTIONS
-- One row per double-entry transaction (a group of entries)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ledger_transactions (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Idempotency key — the event ID from the source system.
    -- UNIQUE constraint: an event can only be processed once.
    event_id     TEXT NOT NULL UNIQUE,

    type         TEXT NOT NULL,
    reference    TEXT NOT NULL,
    currency     TEXT NOT NULL CHECK (length(currency) = 3),

    occurred_at  TIMESTAMPTZ NOT NULL,
    metadata     JSONB NOT NULL DEFAULT '{}',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ledger_tx_reference
    ON ledger_transactions (reference);

CREATE INDEX IF NOT EXISTS idx_ledger_tx_created
    ON ledger_transactions (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ledger_tx_type_created
    ON ledger_transactions (type, created_at DESC);

-- ------------------------------------------------------------
-- LEDGER ENTRIES
-- Individual debit/credit lines (immutable)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ledger_entries (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id  UUID NOT NULL REFERENCES ledger_transactions(id) ON DELETE RESTRICT,

    account_type    TEXT NOT NULL CHECK (account_type IN ('author', 'platform', 'tax')),
    account_key     TEXT NOT NULL,

    debit           NUMERIC(20, 8) NOT NULL DEFAULT 0 CHECK (debit >= 0),
    credit          NUMERIC(20, 8) NOT NULL DEFAULT 0 CHECK (credit >= 0),

    currency        TEXT NOT NULL CHECK (length(currency) = 3),

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Enforce: exactly one of debit/credit is non-zero
    CHECK ((debit = 0) <> (credit = 0))
);

-- Balance queries: WHERE account_type = ? AND account_key = ? [AND currency = ?]
CREATE INDEX IF NOT EXISTS idx_ledger_entries_account
    ON ledger_entries (account_type, account_key, currency);

-- Transaction lookup: WHERE transaction_id = ?
CREATE INDEX IF NOT EXISTS idx_ledger_entries_tx
    ON ledger_entries (transaction_id);

-- ------------------------------------------------------------
-- PROCESSED EVENTS (idempotency)
-- The unique constraint on event_id is the idempotency barrier.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS processed_events (
    event_id       TEXT PRIMARY KEY,
    event_type     TEXT NOT NULL,
    transaction_id UUID REFERENCES ledger_transactions(id) ON DELETE RESTRICT,
    processed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_processed_events_processed_at
    ON processed_events (processed_at DESC);

-- ------------------------------------------------------------
-- PAYOUTS
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payouts (
    id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    author_id              UUID NOT NULL,

    amount                 NUMERIC(20, 8) NOT NULL CHECK (amount > 0),
    currency               TEXT NOT NULL CHECK (length(currency) = 3),

    stripe_transfer_id     TEXT,
    stripe_payout_id       TEXT,

    status                 TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
    reason                 TEXT,

    ledger_transaction_id  UUID REFERENCES ledger_transactions(id) ON DELETE RESTRICT,

    requested_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at           TIMESTAMPTZ,
    failed_at              TIMESTAMPTZ,

    requested_by           UUID NOT NULL,
    admin_notes            TEXT,

    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payouts_author_created
    ON payouts (author_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payouts_status_created
    ON payouts (status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payouts_stripe_transfer
    ON payouts (stripe_transfer_id) WHERE stripe_transfer_id IS NOT NULL;

-- ------------------------------------------------------------
-- AUTHORS CONNECT ACCOUNTS (Stripe Connect)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS author_connect_accounts (
    author_id              UUID PRIMARY KEY,

    stripe_account_id      TEXT NOT NULL UNIQUE,
    status                 TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'active', 'restricted', 'disabled')),

    -- KYC / requirements from Stripe
    charges_enabled        BOOLEAN NOT NULL DEFAULT FALSE,
    payouts_enabled        BOOLEAN NOT NULL DEFAULT FALSE,
    details_submitted      BOOLEAN NOT NULL DEFAULT FALSE,

    -- Raw requirements JSON from Stripe (for display in UI)
    requirements_due       JSONB NOT NULL DEFAULT '[]',
    disabled_reason        TEXT,

    onboarded_at           TIMESTAMPTZ,
    last_stripe_sync_at    TIMESTAMPTZ,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_connect_status
    ON author_connect_accounts (status);

CREATE INDEX IF NOT EXISTS idx_connect_account
    ON author_connect_accounts (stripe_account_id);

COMMIT;