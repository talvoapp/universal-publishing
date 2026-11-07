# syntax=docker/dockerfile:1.7
# ============================================================
# Editor Service — Production Dockerfile
#
# Multi-stage build. Runtime image:
#   - Non-root (UID 10001)
#   - Uses `tini` as PID 1 for signal forwarding (critical: WebSocket
#     server needs to receive SIGTERM to send close frames gracefully)
#   - Health check via HTTP /health (WebSocket shares the same port)
# ============================================================

# ------------------------------------------------------------
# STAGE 1: DEPENDENCIES
# ------------------------------------------------------------
FROM node:20-alpine AS deps

WORKDIR /app

# Alpine compatibility for potentially native modules
RUN apk add --no-cache libc6-compat python3 make g++

COPY package.json package-lock.json* ./

# Install all deps (dev + prod) for the builder stage
RUN npm ci --no-audit --no-fund

# ------------------------------------------------------------
# STAGE 2: BUILDER
# ------------------------------------------------------------
FROM node:20-alpine AS builder

WORKDIR /app

RUN apk add --no-cache libc6-compat

COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src ./src

RUN npx tsc -p tsconfig.json

# Prune dev dependencies
RUN npm prune --omit=dev

# ------------------------------------------------------------
# STAGE 3: RUNTIME
# ------------------------------------------------------------
FROM node:20-alpine AS runtime

RUN apk add --no-cache libc6-compat tini curl

RUN addgroup -g 10001 -S nodejs \
 && adduser  -u 10001 -S editorsvc -G nodejs

WORKDIR /app

COPY --from=builder --chown=editorsvc:nodejs /app/dist         ./dist
COPY --from=builder --chown=editorsvc:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=editorsvc:nodejs /app/package.json ./package.json

ENV NODE_ENV=production \
    NODE_OPTIONS="--max-old-space-size=512" \
    PORT=4002

USER editorsvc

EXPOSE 4002

# NOTE: WebSocket uses the same HTTP port; health check via HTTP only.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl --fail --silent --show-error http://127.0.0.1:4002/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]