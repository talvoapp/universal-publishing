"""
Centralized configuration for formatting-service.

Loads env vars once at startup, validates with Pydantic, exposes a
frozen settings object. Fail-fast on missing required values.

Note: this is a pure worker service — no user-facing HTTP except
health/readiness. All real work arrives via RabbitMQ.
"""

from __future__ import annotations

import os
from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings, loaded from env vars / .env."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # -------- Runtime --------
    env: Literal["development", "test", "production"] = Field(
        default="development", alias="NODE_ENV"
    )  # reuse the same env var name as Node services for consistency
    log_level: str = Field(default="info", alias="LOG_LEVEL")
    tz: str = Field(default="UTC", alias="TZ")

    # -------- HTTP (health only) --------
    port: int = Field(default=4008, alias="PORT")

    # -------- RabbitMQ --------
    rabbitmq_url: str = Field(..., alias="RABBITMQ_URL")
    rabbitmq_queue: str = Field(
        default="formatting.jobs", alias="RABBITMQ_QUEUE"
    )
    rabbitmq_exchange: str = Field(
        default="formatting", alias="RABBITMQ_EXCHANGE"
    )
    rabbitmq_routing_key: str = Field(
        default="formatting.job", alias="RABBITMQ_ROUTING_KEY"
    )
    rabbitmq_prefetch: int = Field(
        default=2, alias="RABBITMQ_PREFETCH", ge=1, le=20
    )
    rabbitmq_heartbeat: int = Field(
        default=60, alias="RABBITMQ_HEARTBEAT", ge=10, le=600
    )
    rabbitmq_connection_timeout: int = Field(
        default=15, alias="RABBITMQ_CONNECTION_TIMEOUT", ge=5, le=120
    )

    # -------- S3 / MinIO --------
    s3_endpoint: str = Field(..., alias="S3_ENDPOINT")
    s3_access_key: str = Field(..., alias="S3_ACCESS_KEY")
    s3_secret_key: str = Field(..., alias="S3_SECRET_KEY")
    s3_bucket: str = Field(default="upp-assets", alias="S3_BUCKET")
    s3_region: str = Field(default="us-east-1", alias="S3_REGION")
    s3_force_path_style: bool = Field(
        default=True, alias="S3_FORCE_PATH_STYLE"
    )

    # -------- Pandoc / conversion --------
    pandoc_binary: str = Field(default="pandoc", alias="PANDOC_BINARY")
    conversion_timeout_seconds: int = Field(
        default=120, alias="CONVERSION_TIMEOUT_SECONDS", ge=10, le=600
    )
    max_input_size_bytes: int = Field(
        default=10 * 1024 * 1024,  # 10 MB
        alias="MAX_INPUT_SIZE_BYTES",
    )

    # -------- PDF / WeasyPrint --------
    weasyprint_base_url: str = Field(
        default="", alias="WEASYPRINT_BASE_URL"
    )
    pdf_page_size: str = Field(default="A5", alias="PDF_PAGE_SIZE")
    pdf_margin_mm: int = Field(default=20, alias="PDF_MARGIN_MM", ge=5, le=50)

    # -------- Cover generation (optional DALL-E) --------
    openai_api_key: str | None = Field(default=None, alias="OPENAI_API_KEY")
    dalle_model: str = Field(default="dall-e-3", alias="DALLE_MODEL")
    cover_thumbnail_width: int = Field(
        default=400, alias="COVER_THUMBNAIL_WIDTH", ge=100, le=2000
    )
    cover_thumbnail_height: int = Field(
        default=600, alias="COVER_THUMBNAIL_HEIGHT", ge=100, le=3000
    )

    # -------- Worker behavior --------
    worker_concurrency: int = Field(
        default=2, alias="WORKER_CONCURRENCY", ge=1, le=10
    )
    job_max_retries: int = Field(default=3, alias="JOB_MAX_RETRIES", ge=0, le=10)

    # -------- Observability --------
    otel_exporter_otlp_endpoint: str | None = Field(
        default=None, alias="OTEL_EXPORTER_OTLP_ENDPOINT"
    )
    sentry_dsn: str | None = Field(default=None, alias="SENTRY_DSN")
    service_name: str = Field(default="formatting-service", alias="SERVICE_NAME")
    service_version: str = Field(default="1.0.0", alias="SERVICE_VERSION")

    # --------------------------------------------------------
    # Validators
    # --------------------------------------------------------
    @field_validator("rabbitmq_url")
    @classmethod
    def _validate_rabbitmq_url(cls, v: str) -> str:
        if not (v.startswith("amqp://") or v.startswith("amqps://")):
            raise ValueError("RABBITMQ_URL must start with amqp:// or amqps://")
        return v

    @field_validator("s3_endpoint")
    @classmethod
    def _validate_s3_endpoint(cls, v: str) -> str:
        if not (v.startswith("http://") or v.startswith("https://")):
            raise ValueError("S3_ENDPOINT must start with http:// or https://")
        return v.rstrip("/")

    @property
    def is_prod(self) -> bool:
        return self.env == "production"

    @property
    def is_dev(self) -> bool:
        return self.env == "development"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Cached settings singleton."""
    return Settings()


# Convenience module-level accessor (imported widely)
settings = get_settings()