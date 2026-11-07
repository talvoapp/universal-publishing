# syntax=docker/dockerfile:1.7
# ============================================================
# Formatting Service — Production Dockerfile (Python)
#
# This is the most system-package-heavy service in the platform:
#   - pandoc           → Markdown → HTML/EPUB/DOCX
#   - WeasyPrint       → HTML → PDF (needs pango, cairo, gdk-pixbuf)
#   - Pillow           → image processing (needs libjpeg, zlib)
#   - cairosvg         → SVG → PNG (needs cairo)
#   - boto3            → S3 (pure Python)
#
# Base image: python:3.11-slim-bookworm (Debian Bookworm).
# Image size ~600-800 MB — acceptable for a worker.
# ============================================================

# ------------------------------------------------------------
# STAGE 1: BUILDER (compile Python wheels)
# ------------------------------------------------------------
FROM python:3.11-slim-bookworm AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Build-time dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential \
      gcc \
      g++ \
      libffi-dev \
      libssl-dev \
      libcairo2-dev \
      libpango1.0-dev \
      libgdk-pixbuf-2.0-dev \
      libjpeg-dev \
      zlib1g-dev \
      libxml2-dev \
      libxslt1-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /wheels

COPY requirements.txt .
RUN pip wheel --wheel-dir=/wheels -r requirements.txt

# ------------------------------------------------------------
# STAGE 2: RUNTIME (minimal system deps only)
# ------------------------------------------------------------
FROM python:3.11-slim-bookworm AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PORT=4008

# Runtime system dependencies:
#   - pandoc:           the actual binary we shell out to
#   - libpango/cairo:   WeasyPrint rendering
#   - libgdk-pixbuf:    WeasyPrint image handling
#   - libjpeg/zlib:     Pillow
#   - fontconfig + fonts: PDF typography
#   - libmagic:         file type detection (boto3 uses it occasionally)
#   - tini:             PID 1 for signals
#   - curl:             health check
RUN apt-get update && apt-get install -y --no-install-recommends \
      pandoc \
      libpango-1.0-0 \
      libpangoft2-1.0-0 \
      libcairo2 \
      libgdk-pixbuf-2.0-0 \
      libjpeg62-turbo \
      zlib1g \
      libmagic1 \
      fontconfig \
      fonts-dejavu-core \
      fonts-dejavu-extra \
      fonts-liberation \
      tini \
      curl \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && fc-cache -f

# Non-root user
RUN groupadd -g 10001 -r app \
 && useradd  -u 10001 -r -g app -s /sbin/nologin app

WORKDIR /app

# Install wheels
COPY --from=builder /wheels /wheels
COPY requirements.txt .
RUN pip install --no-index --find-links=/wheels -r requirements.txt \
 && rm -rf /wheels

# Copy application
COPY --chown=app:app app ./app

# Drop privileges
USER app

EXPOSE 4008

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl --fail --silent --show-error --max-time 4 http://127.0.0.1:4008/health || exit 1

# tini as PID 1 → graceful shutdown on SIGTERM
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["python", "-m", "app.main"]