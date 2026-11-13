// Package main runs SQL migrations against DATABASE_URL.
//
// Usage:
//   go run ./scripts/migrate
//
// Reads all .sql files in internal/db/migrations/ in lexicographic order
// and executes them in a single transaction per file.
package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

func main() {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		log.Fatal("DATABASE_URL is required")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	conn, err := pgx.Connect(ctx, dbURL)
	if err != nil {
		log.Fatalf("connect: %v", err)
	}
	defer conn.Close(ctx)

	migrationsDir := "internal/db/migrations"
	entries, err := os.ReadDir(migrationsDir)
	if err != nil {
		log.Fatalf("read migrations dir: %v", err)
	}

	var files []string
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".sql") {
			files = append(files, e.Name())
		}
	}
	sort.Strings(files)

	for _, f := range files {
		path := filepath.Join(migrationsDir, f)
		body, err := os.ReadFile(path)
		if err != nil {
			log.Fatalf("read %s: %v", f, err)
		}

		log.Printf("→ applying %s", f)
		if _, err := conn.Exec(ctx, string(body)); err != nil {
			log.Fatalf("apply %s: %v", f, err)
		}
	}

	fmt.Println("✅ migrations applied")
}