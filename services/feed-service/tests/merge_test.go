package tests

import (
	"testing"

	"github.com/talvoapp/universal-publishing/feed-service/internal/feed"
)

// ============================================================
// MERGE + CURSOR TESTS (pure unit — no external deps)
// ============================================================

func TestMergeAndSort_BasicMerge(t *testing.T) {
	source1 := map[string]int64{
		"post-a": 1700000100,
		"post-b": 1700000200,
	}
	source2 := map[string]int64{
		"post-c": 1700000300,
		"post-d": 1700000400,
	}

	merged := feed.MergeAndSort(source1, source2, nil, 10)

	if len(merged) != 4 {
		t.Fatalf("expected 4 posts, got %d", len(merged))
	}

	// Should be sorted DESC by score
	expectedOrder := []string{"post-d", "post-c", "post-b", "post-a"}
	for i, expected := range expectedOrder {
		if merged[i].PostID != expected {
			t.Errorf("position %d: expected %s, got %s", i, expected, merged[i].PostID)
		}
	}
}

func TestMergeAndSort_Dedup(t *testing.T) {
	// post-x appears in both sources with different scores
	source1 := map[string]int64{"post-x": 1700000100}
	source2 := map[string]int64{"post-x": 1700000500}

	merged := feed.MergeAndSort(source1, source2, nil, 10)

	if len(merged) != 1 {
		t.Fatalf("expected 1 post (deduped), got %d", len(merged))
	}
	// Should take the HIGHER score
	if merged[0].Score != 1700000500 {
		t.Errorf("expected score 1700000500, got %d", merged[0].Score)
	}
}

func TestMergeAndSort_LimitTruncates(t *testing.T) {
	source1 := map[string]int64{
		"post-a": 1700000100,
		"post-b": 1700000200,
		"post-c": 1700000300,
		"post-d": 1700000400,
		"post-e": 1700000500,
	}

	merged := feed.MergeAndSort(source1, nil, nil, 2)

	if len(merged) != 2 {
		t.Fatalf("expected 2 posts (limited), got %d", len(merged))
	}
	if merged[0].PostID != "post-e" {
		t.Errorf("expected post-e first, got %s", merged[0].PostID)
	}
	if merged[1].PostID != "post-d" {
		t.Errorf("expected post-d second, got %s", merged[1].PostID)
	}
}

func TestMergeAndSort_CursorFilter(t *testing.T) {
	source := map[string]int64{
		"post-a": 1700000100,
		"post-b": 1700000200,
		"post-c": 1700000300,
	}

	cursor := &feed.CursorState{Score: 1700000200, PostID: "post-b"}

	merged := feed.MergeAndSort(source, nil, cursor, 10)

	// Should only include posts strictly OLDER than the cursor
	if len(merged) != 1 {
		t.Fatalf("expected 1 post after cursor, got %d", len(merged))
	}
	if merged[0].PostID != "post-a" {
		t.Errorf("expected post-a (older), got %s", merged[0].PostID)
	}
}

func TestMergeAndSort_EmptySources(t *testing.T) {
	merged := feed.MergeAndSort(nil, nil, nil, 10)
	if len(merged) != 0 {
		t.Errorf("expected 0 posts from empty sources, got %d", len(merged))
	}
}

// ============================================================
// CURSOR TESTS
// ============================================================

func TestCursorRoundTrip(t *testing.T) {
	score := int64(1700000100)
	postID := "post-abc-123"

	encoded := feed.EncodeCursor(score, postID)
	decodedScore, decodedID, err := feed.DecodeCursor(encoded)

	if err != nil {
		t.Fatalf("decode failed: %v", err)
	}
	if decodedScore != score {
		t.Errorf("score mismatch: expected %d, got %d", score, decodedScore)
	}
	if decodedID != postID {
		t.Errorf("postID mismatch: expected %s, got %s", postID, decodedID)
	}
}

func TestCursorInvalidBase64(t *testing.T) {
	_, _, err := feed.DecodeCursor("not-valid-base64!!!")
	if err == nil {
		t.Errorf("expected error for invalid base64")
	}
}

func TestCursorInvalidFormat(t *testing.T) {
	// "abc123" without "_" separator
	_, _, err := feed.DecodeCursor("YWJjMTIz")
	if err == nil {
		t.Errorf("expected error for missing separator")
	}
}