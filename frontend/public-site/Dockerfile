# syntax=docker/dockerfile:1.7
# ============================================================
# Public Site — Production Dockerfile (Next.js standalone)
# ============================================================

# ------------------------------------------------------------
# STAGE 1: DEPENDENCIES
# ------------------------------------------------------------
FROM node:20-alpine AS deps

WORKDIR /app

RUN apk add --no-cache libc6-compat

COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

# ------------------------------------------------------------
# STAGE 2: BUILDER
# ------------------------------------------------------------
FROM node:20-alpine AS builder

WORKDIR /app

RUN apk add --no-cache libc6-compat

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build-time env vars (baked into the build)
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_SITE_NAME
ARG NEXT_PUBLIC_DEFAULT_OG_IMAGE

ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_SITE_NAME=$NEXT_PUBLIC_SITE_NAME
ENV NEXT_PUBLIC_DEFAULT_OG_IMAGE=$NEXT_PUBLIC_DEFAULT_OG_IMAGE
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# ------------------------------------------------------------
# STAGE 3: RUNTIME (minimal)
# ------------------------------------------------------------
FROM node:20-alpine AS runtime

RUN apk add --no-cache curl tini

RUN addgroup -g 10001 -S nodejs \
 && adduser  -u 10001 -S nextjs -G nodejs

WORKDIR /app

# Copy the standalone build output (self-contained with dependencies)
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

ENV NODE_ENV=production \
    PORT=3001 \
    HOSTNAME=0.0.0.0 \
    NODE_OPTIONS="--max-old-space-size=384"

USER nextjs

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl --fail --silent --show-error http://127.0.0.1:3001/api/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]