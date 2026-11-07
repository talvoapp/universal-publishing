"""
Structured logging — structlog configured for JSON output in prod,
pretty output in dev.

Usage:
    from app.utils.logger import get_logger
    log = get_logger(__name__)
    log.info("event_name", key="value", count=3)
"""

from __future__ import annotations

import logging
import sys
from typing import Any

import structlog

_configured = False


def configure_logging(level: str = "info") -> None:
    """Configure structlog + stdlib logging. Call once at startup."""
    global _configured
    if _configured:
        return

    # Try to import settings lazily so `configure_logging` can be called
    # before app.config fully initializes in tests.
    try:
        from app.config import settings  # noqa: PLC0415
        is_prod = settings.is_prod
        env = settings.env
        service = settings.service_name
        version = settings.service_version
    except Exception:  # noqa: BLE001
        is_prod = False
        env = "development"
        service = "formatting-service"
        version = "1.0.0"

    # ----- Standard library logging (used by pika, botocore, etc.) -----
    logging.basicConfig(
        format="%(message)s",
        stream=sys.stdout,
        level=getattr(logging, level.upper(), logging.INFO),
    )

    # Quiet noisy libraries
    logging.getLogger("pika").setLevel(logging.WARNING)
    logging.getLogger("botocore").setLevel(logging.WARNING)
    logging.getLogger("boto3").setLevel(logging.WARNING)
    logging.getLogger("urllib3").setLevel(logging.WARNING)

    # ----- structlog processors -----
    timestamper = structlog.processors.TimeStamper(fmt="iso", utc=True)

    shared_processors: list[Any] = [
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.StackInfoRenderer(),
        timestamper,
    ]

    if is_prod:
        renderer = structlog.processors.JSONRenderer()
        shared_processors.append(
            structlog.processors.format_exc_info,
        )
    else:
        renderer = structlog.dev.ConsoleRenderer(colors=True)

    structlog.configure(
        processors=shared_processors + [renderer],
        wrapper_class=structlog.make_filtering_bound_logger(
            getattr(logging, level.upper(), logging.INFO),
        ),
        context_class=dict,
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )

    # Attach static context (service, version, env) to every log line
    structlog.contextvars.bind_contextvars(
        service=service,
        version=version,
        env=env,
    )

    _configured = True


def get_logger(name: str) -> structlog.stdlib.BoundLogger:
    """Return a logger bound to the given name."""
    if not _configured:
        configure_logging()
    return structlog.get_logger(name)