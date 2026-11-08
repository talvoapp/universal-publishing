-- ============================================================
-- Notification Service — Initial Schema
-- ============================================================

BEGIN;

-- Required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ------------------------------------------------------------
-- NOTIFICATIONS (in-app inbox)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL,

    type            TEXT NOT NULL,
    title           TEXT NOT NULL,
    body            TEXT NOT NULL DEFAULT '',
    link_url        TEXT,
    metadata        JSONB NOT NULL DEFAULT '{}',

    -- Idempotency key (nullable — not all notifications use it)
    idempotency_key TEXT,

    -- Read status
    read_at         TIMESTAMPTZ,

    -- Soft delete (user can dismiss)
    dismissed_at    TIMESTAMPTZ,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique idempotency key (allows NULL, blocks duplicates)
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_idem
    ON notifications (idempotency_key)
    WHERE idempotency_key IS NOT NULL;

-- User inbox query: "my notifications, newest first"
CREATE INDEX IF NOT EXISTS idx_notifications_user_created
    ON notifications (user_id, created_at DESC);

-- Unread count
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
    ON notifications (user_id, created_at DESC)
    WHERE read_at IS NULL AND dismissed_at IS NULL;

-- ------------------------------------------------------------
-- PROCESSED EVENTS (idempotency barrier for Kafka)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS processed_events (
    event_id        TEXT PRIMARY KEY,
    event_type      TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'success'
        CHECK (status IN ('success', 'permanent_error')),
    processed_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_processed_events_type
    ON processed_events (event_type, processed_at DESC);

CREATE INDEX IF NOT EXISTS idx_processed_events_processed_at
    ON processed_events (processed_at DESC);

-- ------------------------------------------------------------
-- Retention: cleanup job removes notifications older than N days
-- (handled by scheduled SQL, not triggered here)
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_notifications_cleanup
    ON notifications (created_at)
    WHERE dismissed_at IS NOT NULL;

COMMIT;