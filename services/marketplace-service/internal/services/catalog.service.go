package services

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/talvoapp/universal-publishing/marketplace-service/internal/models"
	"github.com/talvoapp/universal-publishing/marketplace-service/internal/utils"
)

// CatalogService handles read-only catalog operations (list, get, chapters).
type CatalogService struct {
	db *pgxpool.Pool
}

// NewCatalogService creates a catalog service.
func NewCatalogService(db *pgxpool.Pool) *CatalogService {
	return &CatalogService{db: db}
}

// ListFilter narrows catalog listings.
type ListFilter struct {
	ItemType   models.ItemType
	Category   string
	AuthorID   *uuid.UUID
	CursorTime *time.Time
	CursorID   *uuid.UUID
	Limit      int
}

// List returns published items, newest first, cursor-paginated.
func (s *CatalogService) List(ctx context.Context, f ListFilter) ([]models.Item, *time.Time, *uuid.UUID, error) {
	if f.Limit <= 0 || f.Limit > 100 {
		f.Limit = 20
	}

	query := `
		SELECT id, draft_id, author_id, type, pricing_model, title, description,
		       cover_url, language, tags, price_cents, currency, free_chapters,
		       is_published, word_count, read_minutes, created_at, updated_at
		FROM items
		WHERE is_published = TRUE
	`
	args := []any{}

	if f.ItemType != "" {
		args = append(args, string(f.ItemType))
		query += fmt.Sprintf(" AND type = $%d", len(args))
	}
	if f.AuthorID != nil {
		args = append(args, *f.AuthorID)
		query += fmt.Sprintf(" AND author_id = $%d", len(args))
	}
	if f.CursorTime != nil && f.CursorID != nil {
		args = append(args, *f.CursorTime, *f.CursorID)
		query += fmt.Sprintf(" AND (created_at, id) < ($%d, $%d)", len(args)-1, len(args))
	}

	args = append(args, f.Limit+1) // +1 to detect more
	query += fmt.Sprintf(" ORDER BY created_at DESC, id DESC LIMIT $%d", len(args))

	rows, err := s.db.Query(ctx, query, args...)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("list items: %w", err)
	}
	defer rows.Close()

	var items []models.Item
	for rows.Next() {
		var it models.Item
		if err := rows.Scan(
			&it.ID, &it.DraftID, &it.AuthorID, &it.Type, &it.PricingModel,
			&it.Title, &it.Description, &it.CoverURL, &it.Language, &it.Tags,
			&it.PriceCents, &it.Currency, &it.FreeChapters,
			&it.IsPublished, &it.WordCount, &it.ReadMinutes,
			&it.CreatedAt, &it.UpdatedAt,
		); err != nil {
			return nil, nil, nil, fmt.Errorf("scan item: %w", err)
		}
		items = append(items, it)
	}

	var nextTime *time.Time
	var nextID *uuid.UUID
	if len(items) > f.Limit {
		last := items[f.Limit-1]
		nextTime = &last.CreatedAt
		nextID = &last.ID
		items = items[:f.Limit]
	}

	return items, nextTime, nextID, nil
}

// Get fetches a single item by ID. Returns NotFound if not published.
func (s *CatalogService) Get(ctx context.Context, itemID uuid.UUID) (*models.Item, error) {
	row := s.db.QueryRow(ctx, `
		SELECT id, draft_id, author_id, type, pricing_model, title, description,
		       cover_url, language, tags, price_cents, currency, free_chapters,
		       is_published, word_count, read_minutes, created_at, updated_at
		FROM items
		WHERE id = $1
	`, itemID)

	var it models.Item
	err := row.Scan(
		&it.ID, &it.DraftID, &it.AuthorID, &it.Type, &it.PricingModel,
		&it.Title, &it.Description, &it.CoverURL, &it.Language, &it.Tags,
		&it.PriceCents, &it.Currency, &it.FreeChapters,
		&it.IsPublished, &it.WordCount, &it.ReadMinutes,
		&it.CreatedAt, &it.UpdatedAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, utils.NotFound("Item not found", "ITEM_NOT_FOUND")
		}
		return nil, fmt.Errorf("get item: %w", err)
	}
	if !it.IsPublished {
		return nil, utils.NotFound("Item not found", "ITEM_NOT_FOUND")
	}
	return &it, nil
}

// ListChapters returns all chapters for an item (ordered by index).
func (s *CatalogService) ListChapters(ctx context.Context, itemID uuid.UUID) ([]models.Chapter, error) {
	rows, err := s.db.Query(ctx, `
		SELECT id, item_id, index, title, price_cents, word_count,
		       content_published, created_at, updated_at
		FROM chapters
		WHERE item_id = $1
		ORDER BY index ASC
	`, itemID)
	if err != nil {
		return nil, fmt.Errorf("list chapters: %w", err)
	}
	defer rows.Close()

	var chapters []models.Chapter
	for rows.Next() {
		var c models.Chapter
		if err := rows.Scan(
			&c.ID, &c.ItemID, &c.Index, &c.Title, &c.PriceCents,
			&c.WordCount, &c.ContentPublished, &c.CreatedAt, &c.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan chapter: %w", err)
		}
		chapters = append(chapters, c)
	}
	return chapters, nil
}