//go:build integration

package tests

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

// ============================================================
// CONTENT FETCH TESTS (MongoDB)
// ============================================================

func TestContent_InsertAndFetch(t *testing.T) {
	env := NewTestEnv(t)
	defer env.Cleanup(t)
	env.Truncate(t)

	collection := env.Mongo.Database("upp_editor_test").Collection("drafts")

	now := time.Now()
	doc := bson.M{
		"_id":         primitive.NewObjectID(),
		"ownerId":     uuid.NewString(),
		"title":       "The Test Book",
		"contentType": "article",
		"language":    "en-US",
		"content":     "This is the article content. " + string(make([]byte, 500)),
		"status":      "published",
		"wordCount":   10,
		"readTimeMinutes": 1,
		"publishedAt": now,
		"createdAt":   now,
		"updatedAt":   now,
		"metadata":    bson.M{"tags": []string{"test"}},
	}

	res, err := collection.InsertOne(env.Ctx, doc)
	if err != nil {
		t.Fatalf("insert: %v", err)
	}

	// Fetch it back
	var fetched bson.M
	err = collection.FindOne(env.Ctx, bson.M{"_id": res.InsertedID}).Decode(&fetched)
	if err != nil {
		t.Fatalf("fetch: %v", err)
	}

	if fetched["title"] != "The Test Book" {
		t.Errorf("wrong title: %v", fetched["title"])
	}
	if fetched["status"] != "published" {
		t.Errorf("wrong status: %v", fetched["status"])
	}
}

func TestContent_DraftNotServed(t *testing.T) {
	env := NewTestEnv(t)
	defer env.Cleanup(t)
	env.Truncate(t)

	collection := env.Mongo.Database("upp_editor_test").Collection("drafts")

	// Insert a draft (not published)
	now := time.Now()
	_, err := collection.InsertOne(env.Ctx, bson.M{
		"_id":         primitive.NewObjectID(),
		"ownerId":     uuid.NewString(),
		"title":       "Draft Only",
		"contentType": "article",
		"language":    "en-US",
		"content":     "Not ready",
		"status":      "draft",
		"wordCount":   2,
		"createdAt":   now,
		"updatedAt":   now,
	})
	if err != nil {
		t.Fatalf("insert: %v", err)
	}

	// Query for published only — should find nothing
	count, err := collection.CountDocuments(env.Ctx, bson.M{"status": "published"})
	if err != nil {
		t.Fatalf("count: %v", err)
	}
	if count != 0 {
		t.Errorf("expected 0 published, got %d", count)
	}
}

// ============================================================
// PREVIEW TRUNCATION TESTS (pure unit, no DB)
// ============================================================

func TestTruncateContent(t *testing.T) {
	// Can't test unexported truncateContent from outside the package.
	// This test is a placeholder — the real tests are in
	// internal/services/content_internal_test.go (same package).
	t.Skip("truncateContent is unexported; tested in internal package")
}