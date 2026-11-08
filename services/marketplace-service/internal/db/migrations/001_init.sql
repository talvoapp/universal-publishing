-- ============================================================
-- Marketplace Service — Initial Schema
-- Run once on first startup (or via migration tool).
-- ============================================================

BEGIN;

-- Required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ------------------------------------------------------------
-- ITEMS
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS items (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    draft_id        UUID NOT NULL,
    author_id       UUID NOT NULL,

    type            TEXT NOT NULL CHECK (type IN ('book', 'article', 'news_channel')),
    pricing_model   TEXT NOT NULL CHECK (pricing_model IN ('pay_per_book', 'pay_per_chapter', 'subscription')),

    title           TEXT NOT NULL,
    description     TEXT,
    cover_url       TEXT,
    language        TEXT NOT NULL DEFAULT 'en-US',
    tags            TEXT[] NOT NULL DEFAULT '{}',

    price_cents     BIGINT NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
    currency        TEXT NOT NULL DEFAULT 'USD',
    free_chapters   INT[] NOT NULL DEFAULT '{}',

    is_published    BOOLEAN NOT NULL DEFAULT FALSE,
    word_count      INT NOT NULL DEFAULT 0,
    read_minutes    INT NOT NULL DEFAULT 0,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for catalog browsing
CREATE INDEX IF NOT EXISTS idx_items_published_created
    ON items (created_at DESC, id DESC) WHERE is_published = TRUE;

CREATE INDEX IF NOT EXISTS idx_items_author
    ON items (author_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_items_type_published
    ON items (type, created_at DESC) WHERE is_published = TRUE;

CREATE INDEX IF NOT EXISTS idx_items_tags_gin
    ON items USING GIN (tags);

-- ------------------------------------------------------------
-- CHAPTERS
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chapters (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    item_id             UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    index               INT NOT NULL CHECK (index >= 1),
    title               TEXT NOT NULL,
    price_cents         BIGINT NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
    word_count          INT NOT NULL DEFAULT 0,
    content_published   BOOLEAN NOT NULL DEFAULT FALSE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (item_id, index)
);

CREATE INDEX IF NOT EXISTS idx_chapters_item ON chapters (item_id, index);

-- ------------------------------------------------------------
-- ORDERS
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
    id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    buyer_id                 UUID NOT NULL,
    item_id                  UUID NOT NULL REFERENCES items(id),
    author_id                UUID NOT NULL,
    chapter_ids              UUID[] NOT NULL DEFAULT '{}',

    quantity                 INT NOT NULL DEFAULT 1,
    currency                 TEXT NOT NULL DEFAULT 'USD',

    -- Monetary amounts (decimal, never float)
    subtotal                 NUMERIC(12, 2) NOT NULL DEFAULT 0,
    tax_amount               NUMERIC(12, 2) NOT NULL DEFAULT 0,
    platform_fee             NUMERIC(12, 2) NOT NULL DEFAULT 0,
    author_earnings          NUMERIC(12, 2) NOT NULL DEFAULT 0,
    total                    NUMERIC(12, 2) NOT NULL DEFAULT 0,

    -- Stripe references
    stripe_payment_intent_id TEXT,
    stripe_checkout_id       TEXT,
    stripe_customer_id       TEXT,

    status                   TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'succeeded', 'failed', 'refunded', 'cancelled')),
    failure_reason           TEXT,

    metadata                 JSONB NOT NULL DEFAULT '{}',

    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at             TIMESTAMPTZ,
    refunded_at              TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_orders_buyer_created
    ON orders (buyer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_orders_author_created
    ON orders (author_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_orders_status
    ON orders (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_orders_stripe_pi
    ON orders (stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_stripe_checkout
    ON orders (stripe_checkout_id) WHERE stripe_checkout_id IS NOT NULL;

-- ------------------------------------------------------------
-- SUBSCRIPTIONS
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subscriptions (
    id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    buyer_id                 UUID NOT NULL,
    target_id                UUID NOT NULL,
    target_type              TEXT NOT NULL CHECK (target_type IN ('author', 'news_channel')),
    tier_id                  UUID NOT NULL,

    stripe_subscription_id   TEXT NOT NULL UNIQUE,
    stripe_customer_id       TEXT NOT NULL,

    status                   TEXT NOT NULL DEFAULT 'incomplete'
        CHECK (status IN ('active', 'past_due', 'canceled', 'incomplete', 'trialing')),
    currency                 TEXT NOT NULL DEFAULT 'USD',
    amount                   NUMERIC(12, 2) NOT NULL DEFAULT 0,

    current_period_start     TIMESTAMPTZ NOT NULL DEFAULT now(),
    current_period_end       TIMESTAMPTZ NOT NULL DEFAULT now(),
    cancel_at_period_end     BOOLEAN NOT NULL DEFAULT FALSE,
    canceled_at              TIMESTAMPTZ,
    trial_end                TIMESTAMPTZ,

    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_buyer
    ON subscriptions (buyer_id, status);

CREATE INDEX IF NOT EXISTS idx_subscriptions_target
    ON subscriptions (target_id, target_type, status);

-- ------------------------------------------------------------
-- OUTBOX (transactional outbox for reliable event publishing)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS outbox (
    id            UUID PRIMARY KEY,
    event_type    TEXT NOT NULL,
    aggregate_id  TEXT NOT NULL,
    payload       JSONB NOT NULL,
    meta          JSONB NOT NULL DEFAULT '{}',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at  TIMESTAMPTZ,
    attempts      INT NOT NULL DEFAULT 0,
    last_error    TEXT
);

CREATE INDEX IF NOT EXISTS idx_outbox_pending
    ON outbox (created_at ASC) WHERE published_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_outbox_aggregate
    ON outbox (aggregate_id);

COMMIT;