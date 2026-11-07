"""
EPUB worker — converts a draft into an EPUB3 ebook.

Optionally embeds a cover image already uploaded to S3 (key is passed
in the payload).
"""

from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Any

from app.consumer import PermanentError, TransientError, register_handler
from app.services import pandoc_service, s3_service
from app.config import settings
from app.utils.logger import get_logger


log = get_logger(__name__)


def handle_epub_job(payload: dict[str, Any]) -> None:
    draft_id = payload.get("draftId")
    title = (payload.get("title") or "Untitled").strip()
    author = (payload.get("author") or "Unknown").strip()
    content = payload.get("content") or ""
    output_key = payload.get("outputKey") or f"drafts/{draft_id}/export.epub"
    cover_key = payload.get("coverKey")
    request_id = payload.get("requestId", "unknown")

    # ----- Validate -----
    if not draft_id:
        raise PermanentError("Missing draftId")
    if not content.strip():
        raise PermanentError("Empty content — nothing to render")
    if len(content.encode("utf-8")) > settings.max_input_size_bytes:
        raise PermanentError("Content too large")

    log.info(
        "epub_job_start",
        draft_id=draft_id,
        title=title,
        has_cover=bool(cover_key),
        request_id=request_id,
    )

    # ----- Download cover (if any) -----
    s3 = s3_service.S3Service()
    cover_path: str | None = None
    if cover_key:
        try:
            cover_bytes = s3.download_bytes(cover_key)
            tmpdir = Path(tempfile.mkdtemp(prefix="epub-cover-"))
            cover_file = tmpdir / "cover.jpg"
            cover_file.write_bytes(cover_bytes)
            cover_path = str(cover_file)
            log.info("epub_cover_downloaded", bytes=len(cover_bytes))
        except Exception as e:  # noqa: BLE001
            # Cover is optional — log and continue without it.
            log.warning("epub_cover_download_failed", error=str(e))
            cover_path = None

    # ----- Render -----
    try:
        epub_bytes = pandoc_service.markdown_to_epub(
            markdown_text=content,
            title=title,
            author=author,
            cover_image_path=cover_path,
        )
    except TimeoutError as e:
        raise TransientError(f"EPUB render timed out: {e}") from e
    except RuntimeError as e:
        raise PermanentError(f"EPUB render failed: {e}") from e

    # ----- Upload -----
    try:
        uri = s3.upload_file(
            key=output_key,
            data=epub_bytes,
            content_type="application/epub+zip",
        )
    except Exception as e:  # noqa: BLE001
        raise TransientError(f"S3 upload failed: {e}") from e

    log.info(
        "epub_job_done",
        draft_id=draft_id,
        output_key=output_key,
        size_bytes=len(epub_bytes),
        s3_uri=uri,
        request_id=request_id,
    )


def register() -> None:
    register_handler("format.epub", handle_epub_job)