// Package feed implements the read/write paths for the feed.
//
// The core algorithm is HYBRID FAN-OUT (see consumer/event_consumer.go
// for the write path). This package owns the READ path:
//
//   Normal reader's feed = pre-computed timeline (Redis ZSet)
//                       + recent posts from celebrity authors they follow
//   Both sources are merged, sorted by score (descending), and paginated.
package feed

import (
	"encoding/base64"
	"fmt"
	"strconv"
	"strings"
)

// Cursor encoding — kept in this package (not models) so the wire format
// can change without breaking the model types.
//
// Encoding: base64("{score}_{postID}")
const cursorSeparator = "_"

// EncodeCursor converts (score, postID) → opaque cursor string.
func EncodeCursor(score int64, postID string) string {
	raw := fmt.Sprintf("%d%s%s", score, cursorSeparator, postID)
	return base64.RawURLEncoding.EncodeToString([]byte(raw))
}

// DecodeCursor parses an opaque cursor string back to (score, postID).
// Returns error if malformed.
func DecodeCursor(cursor string) (score int64, postID string, err error) {
	decoded, err := base64.RawURLEncoding.DecodeString(cursor)
	if err != nil {
		return 0, "", fmt.Errorf("invalid cursor encoding: %w", err)
	}
	parts := strings.SplitN(string(decoded), cursorSeparator, 2)
	if len(parts) != 2 {
		return 0, "", fmt.Errorf("invalid cursor format")
	}
	score, err = strconv.ParseInt(parts[0], 10, 64)
	if err != nil {
		return 0, "", fmt.Errorf("invalid cursor score: %w", err)
	}
	return score, parts[1], nil
}