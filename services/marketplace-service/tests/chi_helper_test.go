//go:build integration

package tests

import (
	"context"

	"github.com/go-chi/chi/v5"
)

// chiRouteContextWith creates a chi route context with a single URL param.
// Needed because chi stores params in a private context type; this
// recreates that context for testing purposes.
func chiRouteContextWith(ctx context.Context, key, value string) context.Context {
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add(key, value)
	return context.WithValue(ctx, chi.RouteCtxKey, rctx)
}