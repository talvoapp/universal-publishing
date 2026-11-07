"""
DOCX worker — converts a draft into an editable DOCX file.

DOCX is useful for authors who want to continue editing in Word or
Google Docs.
"""

from __future__ import annotations

from typing import Any

from app.consumer import PermanentError, TransientError, register_handler
from app.services import pandoc_service, s3_service
from app.config import settings
from app.utils.logger import get_logger


log = get_logger(__name__)


def handle_docx_job(payload: dict[str, Any]) -> None:
    draft_id = payload.get("draftId")
    title = (payload.get("title") or "Untitled").strip()
    author = (payload.get("author") or "Unknown").strip()
    content = payload.get("content") or ""
    output_key = payload.get("outputKey") or f"drafts/{draft_id}/export.docx"
    request_id = payload.get("requestId", "unknown")

    if not draft_id:
        raise PermanentError("Missing draftId")
    if not content.strip():
        raise PermanentError("Empty content — nothing to render")
    if len(content.encode("utf-8")) > settings.max_input_size_bytes:
        raise PermanentError("Content too large")

    log.info(
        "docx_job_start",
        draft_id=draft_id,
        title=title,
        request_id=request_id,
    )

    try:
        docx_bytes = pandoc_service.markdown_to_docx(
            markdown_text=content,
            title=title,
            author=author,
        )
    except TimeoutError as e:
        raise TransientError(f"DOCX render timed out: {e}") from e
    except RuntimeError as e:
        raise PermanentError(f"DOCX render failed: {e}") from e

    s3 = s3_service.S3Service()
    try:
        uri = s3.upload_file(
            key=output_key,
            data=docx_bytes,
            content_type=(
                "application/vnd.openxmlformats-officedocument."
                "wordprocessingml.document"
            ),
        )
    except Exception as e:  # noqa: BLE001
        raise TransientError(f"S3 upload failed: {e}") from e

    log.info(
        "docx_job_done",
        draft_id=draft_id,
        output_key=output_key,
        size_bytes=len(docx_bytes),
        s3_uri=uri,
        request_id=request_id,
    )


def register() -> None:
    register_handler("format.docx", handle_docx_job)