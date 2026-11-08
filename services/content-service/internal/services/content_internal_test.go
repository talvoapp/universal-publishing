package services

import (
	"strings"
	"testing"
)

// TestTruncateContent — internal unit test for the truncation logic.
// Requires no DB.
func TestTruncateContent(t *testing.T) {
	content := "The quick brown fox jumps over the lazy dog. " + strings.Repeat("More words here. ", 100)

	// 15% of content
	excerpt, truncated := truncateContent(content, 0.15)
	if !truncated {
		t.Errorf("expected truncated=true")
	}
	if len(excerpt) >= len(content) {
		t.Errorf("expected excerpt shorter than content")
	}
	if !strings.HasSuffix(excerpt, "…") {
		t.Errorf("expected ellipsis at end")
	}

	// 100% → no truncation
	full, truncated := truncateContent(content, 1.0)
	if truncated {
		t.Errorf("expected truncated=false for fraction=1.0")
	}
	if full != content {
		t.Errorf("expected full content returned")
	}

	// 0% → empty + ellipsis
	empty, truncated := truncateContent(content, 0.0)
	if !truncated {
		t.Errorf("expected truncated=true for fraction=0")
	}
	if empty != "…" && !strings.HasSuffix(empty, "…") {
		t.Errorf("expected ellipsis, got %q", empty)
	}

	// Empty content → no truncation
	_, truncated = truncateContent("", 0.15)
	if truncated {
		t.Errorf("empty content should not be truncated")
	}
}

func TestBuildSummary_ExtractsFields(t *testing.T) {
	// Placeholder — buildSummary requires a models.ArticleWithChapters
	// Full test requires constructing a Mongo-like document
	t.Skip("buildSummary tested in content_test.go via full pipeline")
}

func TestTruncateContent_UTF8Safe(t *testing.T) {
	// Arabic text — verifies rune-based truncation
	arabicContent := "كتاب الاختبار بالعربية " + strings.Repeat("نص عربي طويل ", 100)

	excerpt, truncated := truncateContent(arabicContent, 0.15)
	if !truncated {
		t.Errorf("expected truncated=true")
	}
	// Verify no broken UTF-8
	for _, r := range excerpt {
		if r == '\uFFFD' {
			t.Errorf("found replacement char — UTF-8 broken")
			break
		}
	}
}