package feed

import (
	"sort"
)

// ScoredPost is a post ID with its score (unix seconds).
type ScoredPost struct {
	PostID string
	Score  int64
}

// MergeAndSort merges two maps of posts and returns them sorted by
// score DESC (newest first), deduplicated by postID.
//
// Duplicates are resolved by taking the HIGHER score (newest). In
// practice this is a defensive measure — a post should never appear
// in both maps.
//
// Returns at most `limit` items. The `cursor` argument (if non-nil)
// filters to items strictly OLDER than the cursor.
func MergeAndSort(
	source1, source2 map[string]int64,
	cursor *CursorState,
	limit int,
) []ScoredPost {
	// Combine into a single map (deduping by max score)
	merged := make(map[string]int64, len(source1)+len(source2))
	for id, score := range source1 {
		merged[id] = score
	}
	for id, score := range source2 {
		if existing, ok := merged[id]; !ok || score > existing {
			merged[id] = score
		}
	}

	// Filter by cursor
	items := make([]ScoredPost, 0, len(merged))
	for id, score := range merged {
		if cursor != nil {
			// Exclude items that are NEWER than or EQUAL to the cursor
			// (they've already been seen on previous pages)
			if score > cursor.Score {
				continue
			}
			if score == cursor.Score && id >= cursor.PostID {
				continue
			}
		}
		items = append(items, ScoredPost{PostID: id, Score: score})
	}

	// Sort: score DESC, then postID DESC (stable tie-break)
	sort.Slice(items, func(i, j int) bool {
		if items[i].Score != items[j].Score {
			return items[i].Score > items[j].Score
		}
		return items[i].PostID > items[j].PostID
	})

	// Trim to limit
	if len(items) > limit {
		items = items[:limit]
	}

	return items
}

// CursorState represents the pagination cursor.
type CursorState struct {
	Score  int64
	PostID string
}