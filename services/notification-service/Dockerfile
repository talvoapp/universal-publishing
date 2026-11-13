# syntax=docker/dockerfile:1.7
# ============================================================
# Notification Service — Production Dockerfile
#
# All dependencies are pure JavaScript (no native modules).
# No build tools required in the deps stage.
# ============================================================

# ------------------------------------------------------------
# STAGE 1: DEPENDENCIES
# ------------------------------------------------------------
FROM node:20-alpine AS deps

WORKDIR /app

# Only libc6-compat needed (some transitive deps may reference it)
RUN apk add --no-cache libc6-compat

COPY package.json package-lock.json* ./

# `npm ci` (deterministic install from lockfile)
# If lockfile is missing (fresh checkout), falls back to `npm install`
RUN if [ -f package-lock.json ]; then \
      npm ci --no-audit --no-fund; \
    else \
      npm install --no-audit --no-fund; \
    fi

# ------------------------------------------------------------
# STAGE 2: BUILDER (TypeScript → JavaScript)
# ------------------------------------------------------------
FROM node:20-alpine AS builder

WORKDIR /app

RUN apk add --no-cache libc6-compat

COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src ./src

# Compile
RUN npx tsc -p tsconfig.json

# Prune dev dependencies for runtime
RUN npm prune --omit=dev

# ------------------------------------------------------------
# STAGE 3: RUNTIME (minimal)
# ------------------------------------------------------------
FROM node:20-alpine AS runtime

# tini = signal forwarding (graceful shutdown)
# curl = healthcheck
RUN apk add --no-cache libc6-compat tini curl

# Non-root user
RUN addgroup -g 10001 -S nodejs \
 && adduser  -u 10001 -S notifysvc -G nodejs

WORKDIR /app

# Copy built artifacts
COPY --from=builder --chown=notifysvc:nodejs /app/dist         ./dist
COPY --from=builder --chown=notifysvc:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=notifysvc:nodejs /app/package.json ./package.json

# TypeScript doesn't copy .hbs files to dist/, so copy templates manually
COPY --chown=notifysvc:nodejs src/templates ./dist/templates

ENV NODE_ENV=production \
    NODE_OPTIONS="--max-old-space-size=384" \
    PORT=4008

USER notifysvc

EXPOSE 4008

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl --fail --silent --show-error http://127.0.0.1:4008/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]