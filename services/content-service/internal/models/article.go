// Package models defines the domain structs for content-service.
//
// Content lives in MongoDB (from editor-service) and is referenced by
// ID from PostgreSQL (marketplace entitlements). The models here are
// READ-ONLY projections of the Mongo documents — content-service never
// writes to the content store.
package models

import (
	"time"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

// ContentType is the kind of draft.
type ContentType string

const (
	ContentTypeArticle ContentType = "article"
	ContentTypeBook    ContentType = "book"
	ContentTypeNews    ContentType = "news_post"
)

// Article is the projection of a published draft from MongoDB.
//
// Only the fields content-service needs are declared. Any additional
// fields in the Mongo document are ignored (Mongo driver skips unknowns
// by default).
type Article struct {
	ID          primitive.ObjectID `bson:"_id"`
	DraftID     primitive.ObjectID `bson:"ownerId"` // matches editor-service schema
	Title       string             `bson:"title"`
	ContentType ContentType        `bson:"contentType"`
	Language    string             `bson:"language"`
	Content     string             `bson:"content"` // full markdown
	Metadata    map[string]any     `bson:"metadata"`
	Status      string             `bson:"status"` // must be "published" to be readable
	WordCount   int                `bson:"wordCount"`
	ReadMinutes int                `bson:"readTimeMinutes"`
	PublishedAt *time.Time         `bson:"publishedAt"`
	CreatedAt   time.Time          `bson:"createdAt"`
	UpdatedAt   time.Time          `bson:"updatedAt"`
}

// Chapter is a published chapter projection.
//
// In editor-service, chapters live inside a book's document. Content-service
// reads them from the parent draft's `chapters` array (a Mongo sub-array).
// The marketplace mirrors chapters to its own `chapters` table for
// pricing/entitlement lookups.
type Chapter struct {
	Index       int    `bson:"index" json:"index"`
	Title       string `bson:"title" json:"title"`
	Content     string `bson:"content" json:"-"` // not returned in list; only on read
	WordCount   int    `bson:"wordCount" json:"wordCount"`
	ContentHTML string `bson:"contentHtml,omitempty" json:"-"`
}

// ArticleWithChapters is a book with its chapters expanded.
type ArticleWithChapters struct {
	Article
	Chapters []Chapter `bson:"chapters"`
}