# syntax=docker/dockerfile:1.7
# ============================================================
# Auth Service — Production Dockerfile
#
# Multi-stage build:
#   1. deps     — install production + build dependencies
#   2. builder  — compile TypeScript → dist/
#   3. runtime  — minimal image with only dist/ + prod node_modules
#
# Result: ~180 MB image, non-root user, health check built in.
# ============================================================

# ------------------------------------------------------------
# STAGE 1: DEPENDENCIES (all, including dev — needed for build)
# ------------------------------------------------------------
FROM node:20-alpine AS deps

WORKDIR /app

# Alpine needs libc6-compat for some native modules (bcrypt).
# Also install build tools for any module that compiles natively.
RUN apk add --no-cache \
      libc6-compat \
      python3 \
      make \
      g++

# Copy manifest files first for better cache layers
COPY package.json package-lock.json* ./

# Install ALL dependencies (dev + prod) — builder needs tsc, @types, etc.
RUN npm ci --no-audit --no-fund

# ------------------------------------------------------------
# STAGE 2: BUILDER (TypeScript → JavaScript)
# ------------------------------------------------------------
FROM node:20-alpine AS builder

WORKDIR /app

RUN apk add --no-cache libc6-compat

# Bring node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy source
COPY package.json tsconfig.json ./
COPY src ./src

# Compile
RUN npx tsc -p tsconfig.json

# Prune dev dependencies from node_modules for the runtime stage.
# We do it here (not in deps) so `builder` still has tsc available.
RUN npm prune --omit=dev

# ------------------------------------------------------------
# STAGE 3: RUNTIME (minimal)
# ------------------------------------------------------------
FROM node:20-alpine AS runtime

# -------- System hardening --------
RUN apk add --no-cache \
      libc6-compat \
      tini \
      curl

# Create non-root user (UID 10001 is common in K8s securityContext)
RUN addgroup -g 10001 -S nodejs \
 && adduser  -u 10001 -S authsvc -G nodejs

# -------- App directory --------
WORKDIR /app

# Copy built artifacts + pruned node_modules with correct ownership
COPY --from=builder --chown=authsvc:nodejs /app/dist         ./dist
COPY --from=builder --chown=authsvc:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=authsvc:nodejs /app/package.json ./package.json

# -------- Runtime config --------
ENV NODE_ENV=production \
    NODE_OPTIONS="--max-old-space-size=384" \
    PORT=4001

# Drop privileges
USER authsvc

# Expose service port (informational only)
EXPOSE 4001

# Health check — the /health endpoint must return 200 within 5 s
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl --fail --silent --show-error http://127.0.0.1:4001/health || exit 1

# tini as PID 1 → forwards SIGTERM to node, reaps zombies
ENTRYPOINT ["/sbin/tini", "--"]

# Launch compiled JS (no tsx in production)
CMD ["node", "dist/index.js"]