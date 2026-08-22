# Every target assumes the devbox environment is active (direnv does this on
# `cd`). Without it, run `devbox run make <target>`.

.DEFAULT_GOAL := help

.PHONY: help
help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  %-14s %s\n", $$1, $$2}'

.PHONY: deps
deps: frontend/node_modules ## Install frontend dependencies

frontend/node_modules: frontend/package-lock.json
	cd frontend && npm ci
	@touch $@

.PHONY: dev
dev: ## Print how to run both halves in development
	@echo "Run these in two terminals:"
	@echo "  make dev-backend    # Go API on :8080"
	@echo "  make dev-frontend   # Vite on :5173, proxying /api to :8080"

.PHONY: dev-backend
dev-backend: ## Run the Go API with the Echo upstream
	cd backend && go run ./cmd/server

.PHONY: dev-frontend
dev-frontend: deps ## Run the Vite dev server
	cd frontend && npm run dev

.PHONY: test
test: test-backend test-frontend ## Run every test

.PHONY: test-backend
test-backend: ## Run the Go tests
	cd backend && go test ./...

.PHONY: test-frontend
test-frontend: deps ## Run the frontend tests
	cd frontend && npm run test

# Not part of `make test`: it needs a browser, which CI does not have. Run it
# by hand after touching anything the eye judges — a sheet, a map, a layer
# that sits over another. jsdom renders nothing and will not catch it.
.PHONY: test-browser
test-browser: build-frontend ## Check the sheets over the form in a real browser
	cd frontend && node scripts/browser-checks.mjs

.PHONY: lint
lint: deps ## Vet the Go code and type check the frontend
	cd backend && go vet ./...
	@unformatted=$$(gofmt -l backend); \
	  if [ -n "$$unformatted" ]; then echo "gofmt needed:"; echo "$$unformatted"; exit 1; fi
	cd frontend && npm run typecheck

.PHONY: build
build: build-backend build-frontend ## Build both halves

.PHONY: build-backend
build-backend: ## Build the server binary into backend/bin
	cd backend && go build -o bin/server ./cmd/server

.PHONY: build-frontend
build-frontend: deps ## Build the static site into frontend/dist
	cd frontend && npm run build

# The first page load is the whole point of this client, and nothing else
# measures it: Vite's chunkSizeWarningLimit counts raw bytes and only warns.
.PHONY: size
size: build-frontend ## Check the first page load against its size budget
	cd frontend && node scripts/check-size.mjs dist

# Not part of any build: what this writes is committed. It needs a browser,
# the same one test-browser does. Run it after changing the artwork in
# frontend/brand or the wording on the card, and commit the result.
.PHONY: brand
brand: deps ## Redraw the app tile and the social card from the artwork
	cd frontend && node scripts/make-brand.mjs

.PHONY: clean
clean: ## Remove build output
	rm -rf backend/bin frontend/dist
