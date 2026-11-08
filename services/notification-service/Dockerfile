# syntax=docker/dockerfile:1.7
FROM node:20-alpine AS deps

WORKDIR /app

RUN apk add --no-cache libc6-compat python3 make g++

COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

FROM node:20-alpine AS builder

WORKDIR /app

RUN apk add --no-cache libc6-compat

COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src ./src

RUN npx tsc -p tsconfig.json
RUN npm prune --omit=dev

FROM node:20-alpine AS runtime

RUN apk add --no-cache libc6-compat tini curl

RUN addgroup -g 10001 -S nodejs \
 && adduser  -u 10001 -S notifysvc -G nodejs

WORKDIR /app

COPY --from=builder --chown=notifysvc:nodejs /app/dist ./dist
COPY --from=builder --chown=notifysvc:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=notifysvc:nodejs /app/package.json ./package.json
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