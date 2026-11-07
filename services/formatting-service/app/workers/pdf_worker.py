"""
PDF worker — converts a draft into a print-quality PDF.

Job payload (received via RabbitMQ):
    {
        "jobType": "format.pdf",
        "draftId": "<uuid>",
        "title": "...",
        "author": "...",
        "content": "<markdown>",
        "assetsPrefix": "drafts/<draftId>/",
        "outputKey": "drafts/<draftId>/exports/<exportId>.pdf",
        "metadata": { "language": "en-US", "tags": [...] },
        "requestId": "..."
    }

Flow:
    1. Validate content size + title + author
    2. Convert Markdown → HTML via pandoc_service
    3. Render → PDF via WeasyPrint (with our PDF template)
    4. Upload → S3
    5. Log success (in v2, emit a `FormattingCompleted` event back to Kafka)
"""

from __future__ import annotations

from typing import Any

from app.consumer import PermanentError, TransientError, register_handler
from app.services import pandoc_service, s3_service
from app.config import settings
from app.utils.logger import get_logger
from app.utils.retry import retry_network


log = get_logger(__name__)


# ------------------------------------------------------------
# Job handler
# ------------------------------------------------------------
def handle_pdf_job(payload: dict[str, Any]) -> None:
    draft_id = payload.get("draftId")
    title = (payload.get("title") or "Untitled").strip()
    author = (payload.get("author") or "Unknown").strip()
    content = payload.get("content") or ""
    output_key = payload.get("outputKey") or f"drafts/{draft_id}/export.pdf"
    request_id = payload.get("requestId", "unknown")

    # ----- Validate -----
    if not draft_id:
        raise PermanentError("Missing draftId")
    if not content.strip():
        raise PermanentError("Empty content — nothing to render")
    content_bytes = content.encode("utf-8")
    if len(content_bytes) > settings.max_input_size_bytes:
        raise PermanentError(
            f"Content too large: {len(content_bytes)} > "
            f"{settings.max_input_size_bytes}"
        )

    log.info(
        "pdf_job_start",
        draft_id=draft_id,
        title=title,
        content_bytes=len(content_bytes),
        request_id=request_id,
    )

    # ----- Render -----
    try:
        pdf_bytes = pandoc_service.markdown_to_pdf(
            markdown_text=content,
            title=title,
            author=author,
        )
    except TimeoutError as e:
        # Rendering timeout is retryable — maybe transient load
        raise TransientError(f"PDF render timed out: {e}") from e
    except RuntimeError as e:
        # Pandoc errors are usually due to malformed input — permanent
        raise PermanentError(f"PDF render failed: {e}") from e

    # ----- Upload -----
    s3 = s3_service.S3Service()
    try:
        uri = s3.upload_file(
            key=output_key,
            data=pdf_bytes,
            content_type="application/pdf",
        )
    except Exception as e:  # noqa: BLE001
        # S3 errors are usually transient
        raise TransientError(f"S3 upload failed: {e}") from e

    log.info(
        "pdf_job_done",
        draft_id=draft_id,
        output_key=output_key,
        size_bytes=len(pdf_bytes),
        s3_uri=uri,
        request_id=request_id,
    )


# ------------------------------------------------------------
# Registration
# ------------------------------------------------------------
def register() -> None:
    register_handler("format.pdf", handle_pdf_job)


# Silence unused-import warnings for retry_network (kept for future use)
_ = retry_network