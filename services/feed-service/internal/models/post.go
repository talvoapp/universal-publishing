// Package models defines the domain structs for feed-service.
package models

import (
	"time"
)

// Post is the metadata-only projection of a published draft.
//
// The full content lives in content-service (MongoDB). This service
// only knows: ID, author, title, excerpt, score (publish time).
//
// Posts are NEVER stored in PostgreSQL by feed-service — they are
// derived from Kafka events and cached in Redis Sorted Sets (as
// `postId → score`). The Post metadata (title, excerpt) is fetched
// on-demand from PostgreSQL `posts_metadata` (a thin mirror populated
// from DraftPublished events) OR — in v1 — rebuilt from a simple
// SELECT by ID.
type Post struct {
	ID          string    `json:"id"`
	AuthorID    string    `json:"authorId"`
	Title       string    `json:"title"`
	Excerpt     string    `json:"excerpt"`
	ContentType string    `json:"contentType"`
	WordCount   int       `json:"wordCount"`
	Tags        []string  `json:"tags,omitempty"`
	PublishedAt time.Time `json:"publishedAt"`

	// Score is the Sorted Set score (unix seconds). Used for cursor
	// pagination: `(score, id)` is the stable ordering key.
	Score int64 `json:"-"`
}

// FeedPage is a paginated response of posts.
type FeedPage struct {
	Posts      []Post `json:"posts"`
	NextCursor string `json:"nextCursor,omitempty"`
	HasMore    bool   `json:"hasMore"`
}

// Cursor is the pagination cursor.
//
// Format: base64("{score}_{postID}")
// Example: base64("1700000000_abc123")
type Cursor struct {
	Score  int64
	PostID string
}

// Encode returns a base64 string representation.
func (c Cursor) Encode() string {
	// Opaque to clients. Not cryptographically signed (v1 — v2 adds HMAC).
	// Implementation is in the feed package (to keep models pure).
	return ""
}