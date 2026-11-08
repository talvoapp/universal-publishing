// Package services implements business logic for content-service.
package services

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.uber.org/zap"

	"github.com/talvoapp/universal-publishing/content-service/internal/config"
	"github.com/talvoapp/universal-publishing/content-service/internal/models"
	"github.com/talvoapp/universal-publishing/content-service/internal/utils"
)

// ContentService fetches published content from MongoDB.
type ContentService struct {
	cfg      *config.Config
	db       *mongo.Database
	drafts   *mongo.Collection
	log      *zap.Logger
}

// NewContentService creates a ContentService.
func NewContentService(cfg *config.Config, db *mongo.Database, log *zap.Logger) *ContentService {
	return &ContentService{
		cfg:    cfg,
		db:     db,
		drafts: db.Collection("drafts"),
		log:    log,
	}
}

// GetArticle fetches a published draft by its ID.
//
// If the draft doesn't exist or isn't published, returns NotFound.
func (s *ContentService) GetArticle(ctx context.Context, itemID string) (*models.ArticleWithChapters, error) {
	objID, err := primitive.ObjectIDFromHex(itemID)
	if err != nil {
		return nil, utils.BadRequest("Invalid item ID", "INVALID_ID")
	}

	// Drafts are matched by `_id` (Mongo's internal ID) or by `draftId`
	// (a UUID string set by editor-service). We try both for flexibility.
	filter := bson.M{
		"$and": bson.A{
			bson.M{
				"$or": bson.A{
					bson.M{"_id": objID},
					bson.M{"draftId": itemID},
				},
			},
			bson.M{"status": "published"},
		},
	}

	var doc models.ArticleWithChapters
	err = s.drafts.FindOne(ctx, filter).Decode(&doc)
	if err == mongo.ErrNoDocuments {
		return nil, utils.NotFound("Article not found", "NOT_FOUND")
	}
	if err != nil {
		s.log.Error("mongo_find_failed", zap.Error(err), zap.String("item_id", itemID))
		return nil, utils.Internal("Failed to fetch article", err)
	}

	return &doc, nil
}

// GetChapter fetches a specific chapter from a draft.
//
// Returns the chapter + the parent article (for metadata context).
func (s *ContentService) GetChapter(ctx context.Context, itemID string, chapterIndex int) (*models.ArticleWithChapters, *models.Chapter, error) {
	article, err := s.GetArticle(ctx, itemID)
	if err != nil {
		return nil, nil, err
	}

	for i := range article.Chapters {
		if article.Chapters[i].Index == chapterIndex {
			return article, &article.Chapters[i], nil
		}
	}

	return nil, nil, utils.NotFound(
		fmt.Sprintf("Chapter %d not found", chapterIndex),
		"CHAPTER_NOT_FOUND",
	)
}

// BuildPreview extracts the first N% of the article as an excerpt.
//
// This is the FREE preview shown before purchase. The `PREVIEW_FRACTION`
// config controls the size (default 15%).
//
// For books (with chapters), we use the first chapter's content.
func (s *ContentService) BuildPreview(article *models.ArticleWithChapters) models.Preview {
	fullContent := article.Content
	if article.ContentType == models.ContentTypeBook && len(article.Chapters) > 0 {
		fullContent = article.Chapters[0].Content
	}

	excerpt, truncated := truncateContent(fullContent, s.cfg.PreviewFraction)

	summary := buildSummary(article)

	return models.Preview{
		ArticleSummary:  summary,
		Excerpt:         excerpt,
		Truncated:       truncated,
		PreviewFraction: s.cfg.PreviewFraction,
		PurchaseURL:     "/market/checkout?item=" + summary.ItemID,
	}
}

// BuildChapterPreview extracts the first N% of a specific chapter.
func (s *ContentService) BuildChapterPreview(
	article *models.ArticleWithChapters,
	chapter *models.Chapter,
	chapterID string,
) models.ChapterPreview {
	excerpt, truncated := truncateContent(chapter.Content, s.cfg.PreviewFraction)

	return models.ChapterPreview{
		ItemID:          article.ID.Hex(),
		ChapterID:       chapterID,
		ChapterIndex:    chapter.Index,
		ChapterTitle:    chapter.Title,
		Excerpt:         excerpt,
		Truncated:       truncated,
		PreviewFraction: s.cfg.PreviewFraction,
		PurchaseURL:     fmt.Sprintf("/market/checkout?item=%s&chapter=%s", article.ID.Hex(), chapterID),
	}
}

// BuildFullContent returns the full article content (post-entitlement).
func (s *ContentService) BuildFullContent(
	article *models.ArticleWithChapters,
	entitlementType string,
) models.FullContent {
	return models.FullContent{
		ItemID:          article.ID.Hex(),
		Title:           article.Title,
		ContentType:     string(article.ContentType),
		Language:        article.Language,
		Content:         article.Content,
		WordCount:       article.WordCount,
		ReadMinutes:     article.ReadMinutes,
		PublishedAt:     article.PublishedAt,
		EntitlementType: entitlementType,
	}
}

// BuildFullChapter returns the full chapter content (post-entitlement).
func (s *ContentService) BuildFullChapter(
	article *models.ArticleWithChapters,
	chapter *models.Chapter,
	chapterID string,
	entitlementType string,
) models.FullChapter {
	return models.FullChapter{
		ItemID:          article.ID.Hex(),
		ChapterID:       chapterID,
		ChapterIndex:    chapter.Index,
		ChapterTitle:    chapter.Title,
		Content:         chapter.Content,
		WordCount:       chapter.WordCount,
		EntitlementType: entitlementType,
	}
}

// ListChapterSummaries returns the chapter list without content.
//
// Used by GET /content/{itemID}/chapters to render the table of contents
// before a purchase.
func (s *ContentService) ListChapterSummaries(
	article *models.ArticleWithChapters,
	freeIndices []int,
) []models.ChapterSummary {
	out := make([]models.ChapterSummary, 0, len(article.Chapters))
	freeSet := make(map[int]struct{}, len(freeIndices))
	for _, fi := range freeIndices {
		freeSet[fi] = struct{}{}
	}

	for _, ch := range article.Chapters {
		_, free := freeSet[ch.Index]
		// For non-chaptered items (articles, news), return a single entry.
		// For books, use real chapter metadata.
		out = append(out, models.ChapterSummary{
			ChapterID: fmt.Sprintf("%d", ch.Index), // chapter IDs are index-based in v1
			Index:     ch.Index,
			Title:     ch.Title,
			WordCount: ch.WordCount,
			Free:      free,
		})
	}

	return out
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

// truncateContent returns the first `fraction` of the content (by rune
// count, not byte count — safe for multi-byte UTF-8).
//
// The second return value is `truncated` — true if the content was cut.
func truncateContent(content string, fraction float64) (string, bool) {
	if fraction >= 1.0 || content == "" {
		return content, false
	}

	runes := []rune(content)
	cutoff := int(float64(len(runes)) * fraction)
	if cutoff >= len(runes) {
		return content, false
	}

	// Try to break at a word boundary within the last 20% of the cutoff.
	excerpt := string(runes[:cutoff])
	lastSpace := strings.LastIndex(excerpt, " ")
	if lastSpace > 0 && lastSpace > len(excerpt)*4/5 {
		excerpt = excerpt[:lastSpace]
	}

	return excerpt + "…", true
}

// buildSummary builds the ArticleSummary from an article.
func buildSummary(a *models.ArticleWithChapters) models.ArticleSummary {
	tags := extractStringSlice(a.Metadata, "tags")
	cover := extractString(a.Metadata, "coverImageUrl")

	return models.ArticleSummary{
		ItemID:        a.ID.Hex(),
		Title:         a.Title,
		ContentType:   string(a.ContentType),
		Language:      a.Language,
		WordCount:     a.WordCount,
		ReadMinutes:   a.ReadMinutes,
		CoverImageURL: cover,
		Tags:          tags,
		PublishedAt:   a.PublishedAt,
		Metadata:      a.Metadata,
	}
}

func extractString(m map[string]any, key string) string {
	if v, ok := m[key].(string); ok {
		return v
	}
	return ""
}

func extractStringSlice(m map[string]any, key string) []string {
	raw, ok := m[key]
	if !ok {
		return nil
	}
	arr, ok := raw.(primitive.A)
	if !ok {
		return nil
	}
	out := make([]string, 0, len(arr))
	for _, item := range arr {
		if s, ok := item.(string); ok {
			out = append(out, s)
		}
	}
	return out
}

// BuildSummaryFromArticle exports the internal buildSummary for use
// by handlers that need a public metadata-only response.
func BuildSummaryFromArticle(a *models.ArticleWithChapters) models.ArticleSummary {
	return buildSummary(a)
}

// silence unused imports
var (
	_ = errors.New
	_ = time.Now
)