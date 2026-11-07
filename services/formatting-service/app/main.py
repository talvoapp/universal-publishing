"""
Formatting Service — FastAPI entry point.

This service is a WORKER, not an API. It exposes only:
    - GET /health    — liveness
    - GET /ready     — readiness (RabbitMQ + S3 reachable)
    - GET /metrics   — Prometheus-style metrics (optional)

Real work arrives via RabbitMQ (see app/consumer.py). The FastAPI app
runs in a background thread alongside the blocking consumer so that
Kubernetes liveness probes never hit the consumer's long blocking loop.

Startup order:
    1. Validate config (imported on module load — fails fast)
    2. Initialize S3 client
    3. Start RabbitMQ consumer in a background thread
    4. Start FastAPI server (blocking)

Shutdown order (on SIGTERM):
    1. FastAPI stops accepting new health probes (K8s won't route)
    2. Consumer stops gracefully (finishes current job)
    3. S3 client releases resources
"""

from __future__ import annotations

import threading
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI, Response
from fastapi.responses import JSONResponse

from app.config import settings
from app.consumer import FormattingConsumer
from app.services.s3_service import S3Service
from app.workers import (
    register_pdf_worker,
    register_epub_worker,
    register_docx_worker,
    register_cover_worker,
)
from app.utils.logger import configure_logging, get_logger


# ------------------------------------------------------------
# Logging (must be configured before anything logs)
# ------------------------------------------------------------
configure_logging(level=settings.log_level)
log = get_logger(__name__)


# ------------------------------------------------------------
# Global state (populated in lifespan, released at shutdown)
# ------------------------------------------------------------
_consumer: FormattingConsumer | None = None
_consumer_thread: threading.Thread | None = None
_s3: S3Service | None = None
_shutting_down = False


# ------------------------------------------------------------
# Lifespan (startup / shutdown)
# ------------------------------------------------------------
@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    global _consumer, _consumer_thread, _s3

    log.info(
        "service_starting",
        env=settings.env,
        version=settings.service_version,
        queue=settings.rabbitmq_queue,
    )

    # ----- 1. S3 -----
    _s3 = S3Service()
    _s3.ensure_bucket()
    log.info("s3_ready", bucket=settings.s3_bucket)

    # ----- 2. Register job handlers -----
    register_pdf_worker()
    register_epub_worker()
    register_docx_worker()
    register_cover_worker()

    # ----- 3. Start consumer in a background thread -----
    #     We do this because the consumer is blocking (pika is sync),
    #     and we need the FastAPI event loop to stay responsive for
    #     health probes.
    _consumer = FormattingConsumer()
    _consumer_thread = threading.Thread(
        target=_run_consumer_safely,
        name="rabbitmq-consumer",
        daemon=True,
    )
    _consumer_thread.start()

    log.info("service_started")

    try:
        yield
    finally:
        # ----- Shutdown -----
        global _shutting_down
        _shutting_down = True
        log.info("service_stopping")

        if _consumer:
            _consumer.stop()

        if _consumer_thread and _consumer_thread.is_alive():
            _consumer_thread.join(timeout=30)

        log.info("service_stopped")


def _run_consumer_safely() -> None:
    """Wrap consumer.start() so exceptions don't silently kill the thread."""
    try:
        assert _consumer is not None
        _consumer.start()
    except Exception as e:  # noqa: BLE001
        log.exception("consumer_crashed", error=str(e))
        # Force the process to exit so Kubernetes restarts the pod.
        # A silent thread death would be a hidden failure.
        import os
        os._exit(1)


# ------------------------------------------------------------
# App
# ------------------------------------------------------------
app = FastAPI(
    title="Universal Publishing — Formatting Service",
    version=settings.service_version,
    docs_url="/docs" if not settings.is_prod else None,
    redoc_url=None,
    lifespan=lifespan,
)


# ------------------------------------------------------------
# Health & readiness
# ------------------------------------------------------------
@app.get("/health")
async def health() -> JSONResponse:
    """Liveness — process is up. Doesn't check downstream."""
    if _shutting_down:
        return JSONResponse(
            status_code=503,
            content={"status": "shutting_down"},
        )
    return JSONResponse(
        content={
            "status": "ok",
            "service": settings.service_name,
            "version": settings.service_version,
        }
    )


@app.get("/ready")
async def ready() -> JSONResponse:
    """Readiness — all dependencies reachable."""
    if _shutting_down:
        return JSONResponse(
            status_code=503,
            content={"ready": False, "reason": "shutting_down"},
        )

    checks: dict[str, str] = {}
    all_ok = True

    # RabbitMQ: consumer thread alive
    if _consumer_thread and _consumer_thread.is_alive():
        checks["rabbitmq"] = "ok"
    else:
        checks["rabbitmq"] = "fail"
        all_ok = False

    # S3: HEAD the bucket
    if _s3:
        try:
            _s3.head_bucket()
            checks["s3"] = "ok"
        except Exception as e:  # noqa: BLE001
            log.warning("s3_unhealthy", error=str(e))
            checks["s3"] = "fail"
            all_ok = False
    else:
        checks["s3"] = "fail"
        all_ok = False

    return JSONResponse(
        status_code=200 if all_ok else 503,
        content={"ready": all_ok, "checks": checks},
    )


@app.get("/metrics")
async def metrics() -> Response:
    """Placeholder for Prometheus metrics; wire up prometheus_client later."""
    return Response(
        content="# HELP formatting_service_up 1 if up\n"
                "# TYPE formatting_service_up gauge\n"
                f"formatting_service_up {1 if not _shutting_down else 0}\n",
        media_type="text/plain",
    )


# ------------------------------------------------------------
# Main (dev convenience)
# ------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=settings.port,
        log_level=settings.log_level.lower(),
        reload=settings.is_dev,
    )