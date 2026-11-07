# syntax=docker/dockerfile:1.7
# ============================================================
# AI Service — Production Dockerfile
#
# Important for SSE:
#   - Uses `tini` as PID 1 so SIGTERM is forwarded to Node, which then
#     triggers `closeAllStreams()` before exiting.
#   - Does NOT set a HEALTHCHECK request timeout (Node's HTTP client
#     must be able to open long-lived streams to itself for internal probes).
#     The /health endpoint is a fast synchronous response, so this is fine.
#   - Memory is slightly higher (512 MB) because streaming + token counting
#     + provider SDKs use more RSS than pure CRUD services.
# ============================================================

# ------------------------------------------------------------
# STAGE 1: DEPENDENCIES
# ------------------------------------------------------------
FROM node:20-alpine AS deps

WORKDIR /app

# Alpine compatibility for tiktoken native module
RUN apk add --no-cache libc6-compat python3 make g++

COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

# ------------------------------------------------------------
# STAGE 2: BUILDER
# ------------------------------------------------------------
FROM node:20-alpine AS builder

WORKDIR /app

RUN apk add --no-cache libc6-compat python3 make g++

COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src ./src

RUN npx tsc -p tsconfig.json
RUN npm prune --omit=dev

# ------------------------------------------------------------
# STAGE 3: RUNTIME
# ------------------------------------------------------------
FROM node:20-alpine AS runtime

RUN apk add --no-cache libc6-compat tini curl

RUN addgroup -g 10001 -S nodejs \
 && adduser  -u 10001 -S aiuser -G nodejs

WORKDIR /app

COPY --from=builder --chown=aiuser:nodejs /app/dist         ./dist
COPY --from=builder --chown=aiuser:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=aiuser:nodejs /app/package.json ./package.json

ENV NODE_ENV=production \
    NODE_OPTIONS="--max-old-space-size=512" \
    PORT=4003

USER aiuser

EXPOSE 4003

# Health check: fast synchronous endpoint, no streaming
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl --fail --silent --show-error --max-time 4 http://127.0.0.1:4003/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]