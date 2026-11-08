-- ============================================================
-- Feed Service — Initial Schema
-- Follow graph + counters
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- FOLLOWS
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS follows (
    follower_id UUID NOT NULL,
    followee_id UUID NOT NULL,
    status      TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'blocked', 'pending')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (follower_id, followee_id),
    CHECK (follower_id <> followee_id)
);

-- "who follows me?" — used by consumer to fan out
CREATE INDEX IF NOT EXISTS idx_follows_followee
    ON follows (followee_id, status)
    WHERE status = 'active';

-- "who do I follow?" — used by feed reader
CREATE INDEX IF NOT EXISTS idx_follows_follower
    ON follows (follower_id, status)
    WHERE status = 'active';

-- ------------------------------------------------------------
-- USERS_FOLLOW_COUNTS
-- Denormalized counts for O(1) lookup.
-- Updated by follow/unfollow handlers (inside a transaction).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users_follow_counts (
    user_id          UUID PRIMARY KEY,
    follower_count   BIGINT NOT NULL DEFAULT 0 CHECK (follower_count >= 0),
    following_count  BIGINT NOT NULL DEFAULT 0 CHECK (following_count >= 0),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- "who are the celebrities I follow?" — join follows + counts
CREATE INDEX IF NOT EXISTS idx_counts_celebrity
    ON users_follow_counts (follower_count DESC)
    WHERE follower_count > 1000;  -- matches default CELEBRITY_THRESHOLD

-- ------------------------------------------------------------
-- POSTS_METADATA (v1 — thin mirror of DraftPublished events)
-- Populated by the consumer for feed hydration.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS posts_metadata (
    id              TEXT PRIMARY KEY,
    author_id       UUID NOT NULL,
    title           TEXT NOT NULL DEFAULT '',
    excerpt         TEXT NOT NULL DEFAULT '',
    content_type    TEXT NOT NULL DEFAULT 'article',
    word_count      INT NOT NULL DEFAULT 0,
    published_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_posts_metadata_author
    ON posts_metadata (author_id, published_at DESC);

CREATE INDEX IF NOT EXISTS idx_posts_metadata_published
    ON posts_metadata (published_at DESC);

COMMIT;