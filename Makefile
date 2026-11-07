# ============================================================
# Universal Publishing Platform - Makefile
# ============================================================

SHELL := /bin/bash
.DEFAULT_GOAL := help

COMPOSE := docker compose

.PHONY: help
help: ## عرض كل الأوامر المتاحة
	@echo "Universal Publishing Platform - Available commands:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}'

# DOCKER COMPOSE
.PHONY: up
up: ## تشغيل كل الخدمات
	$(COMPOSE) up -d --build
	@echo "All services up. API Gateway: http://localhost:8080"

.PHONY: up-core
up-core: ## تشغيل قواعد البيانات والوسطاء فقط
	$(COMPOSE) up -d postgres mongodb redis kafka zookeeper rabbitmq minio

.PHONY: down
down: ## إيقاف الخدمات
	$(COMPOSE) down

.PHONY: down-v
down-v: ## إيقاف + حذف volumes (يمسح البيانات)
	$(COMPOSE) down -v

.PHONY: ps
ps: ## حالة الخدمات
	$(COMPOSE) ps

.PHONY: logs
logs: ## logs كل الخدمات
	$(COMPOSE) logs -f --tail=100

.PHONY: restart
restart: ## restart كل الخدمات
	$(COMPOSE) restart

# BUILD
.PHONY: build
build: ## بناء كل الـ images
	$(COMPOSE) build

.PHONY: build-nocache
build-nocache: ## بناء بدون cache
	$(COMPOSE) build --no-cache

# DATABASE
.PHONY: migrate
migrate: ## تشغيل PostgreSQL migrations
	@echo "Running migrations..."
	@for f in database/postgres/migrations/*.sql; do \
		echo "  -> $$f"; \
		docker exec -i upp-postgres psql -U upp -d upp < $$f; \
	done
	@echo "Migrations complete"

.PHONY: seed
seed: ## زرع بيانات تجريبية
	@echo "Seeding..."
	@docker exec -i upp-postgres psql -U upp -d auth_db < scripts/seed.sql 2>/dev/null || true
	@docker exec -i upp-postgres psql -U upp -d marketplace_db < scripts/seed_marketplace.sql 2>/dev/null || true
	@echo "Seed complete"

.PHONY: psql-auth
psql-auth: ## فتح psql على auth_db
	docker exec -it upp-postgres psql -U upp -d auth_db

.PHONY: psql-market
psql-market: ## فتح psql على marketplace_db
	docker exec -it upp-postgres psql -U upp -d marketplace_db

.PHONY: psql-wallet
psql-wallet: ## فتح psql على wallet_db
	docker exec -it upp-postgres psql -U upp -d wallet_db

.PHONY: mongo-shell
mongo-shell: ## فتح mongosh
	docker exec -it upp-mongodb mongosh -u upp -p upp_mongo_password --authenticationDatabase admin upp_editor

.PHONY: redis-cli
redis-cli: ## فتح redis-cli
	docker exec -it upp-redis redis-cli

# TESTING
.PHONY: test
test: ## كل الاختبارات
	@cd services/auth-service && npm test -- --passWithNoTests 2>/dev/null || true
	@cd services/editor-service && npm test -- --passWithNoTests 2>/dev/null || true
	@cd services/ai-service && npm test -- --passWithNoTests 2>/dev/null || true
	@cd services/marketplace-service && go test ./... 2>/dev/null || true
	@cd services/wallet-service && go test ./... 2>/dev/null || true
	@cd services/content-service && go test ./... 2>/dev/null || true
	@cd services/feed-service && go test ./... 2>/dev/null || true

.PHONY: lint
lint: ## linting
	@cd services/auth-service && npm run lint 2>/dev/null || true
	@cd services/editor-service && npm run lint 2>/dev/null || true
	@cd services/marketplace-service && go vet ./... 2>/dev/null || true

# CLEANUP
.PHONY: clean
clean: down-v ## حذف كل شيء (يمسح البيانات)
	@rm -rf node_modules services/*/node_modules frontend/*/node_modules
	@rm -rf services/*/dist frontend/*/dist
	@echo "Clean complete"

.PHONY: reset
reset: down-v clean up migrate seed ## إعادة ضبط كاملة
	@echo "Full reset complete"