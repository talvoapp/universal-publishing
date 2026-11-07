"""
Cover worker — generates a book cover + thumbnail.

Two modes:
    1. AI mode (payload.generateCover == true AND OPENAI_API_KEY set):
       Use DALL-E to generate the base artwork from payload.coverPrompt.
    2. Placeholder mode (default):
       Generate a typographic cover locally with Pillow.

After generation:
    - Upload full-size cover (JPEG) → S3 at payload.outputKey
    - Upload 400x600 thumbnail (JPEG) → S3 at payload.thumbnailKey
"""

from __future__ import annotations

from typing import Any

from app.consumer import PermanentError, TransientError, register_handler
from app.services import dalle_service, image_service, s3_service
from app.utils.logger import get_logger


log = get_logger(__name__)


def handle_cover_job(payload: dict[str, Any]) -> None:
    draft_id = payload.get("draftId")
    title = (payload.get("title") or "Untitled").strip()
    author = (payload.get("author") or "Unknown").strip()
    generate_cover = bool(payload.get("generateCover", False))
    cover_prompt = payload.get("coverPrompt") or title
    output_key = payload.get("outputKey") or f"drafts/{draft_id}/cover.jpg"
    thumbnail_key = (
        payload.get("thumbnailKey") or f"drafts/{draft_id}/cover-thumb.jpg"
    )
    request_id = payload.get("requestId", "unknown")

    if not draft_id:
        raise PermanentError("Missing draftId")

    log.info(
        "cover_job_start",
        draft_id=draft_id,
        title=title,
        ai_mode=generate_cover,
        request_id=request_id,
    )

    # ----- 1. Base artwork -----
    cover_bytes: bytes | None = None
    if generate_cover:
        cover_bytes = dalle_service.generate_cover(prompt=cover_prompt)
        if cover_bytes is None:
            log.warning("cover_dalle_failed_fallback_placeholder")

    if cover_bytes is None:
        # Placeholder (deterministic, always succeeds)
        try:
            cover_bytes = dalle_service.generate_placeholder_cover(
                title=title, author=author
            )
        except Exception as e:  # noqa: BLE001
            raise PermanentError(f"Placeholder cover failed: {e}") from e

    # ----- 2. Normalize -----
    try:
        cover_bytes = image_service.normalize_image(cover_bytes, max_dimension=2000)
    except Exception as e:  # noqa: BLE001
        raise PermanentError(f"Cover normalization failed: {e}") from e

    # ----- 3. Thumbnail -----
    try:
        thumb_bytes = image_service.make_thumbnail(
            cover_bytes, width=400, height=600, fmt="JPEG"
        )
    except Exception as e:  # noqa: BLE001
        raise PermanentError(f"Thumbnail generation failed: {e}") from e

    # ----- 4. Upload both -----
    s3 = s3_service.S3Service()
    try:
        cover_uri = s3.upload_file(
            key=output_key,
            data=cover_bytes,
            content_type="image/jpeg",
        )
        thumb_uri = s3.upload_file(
            key=thumbnail_key,
            data=thumb_bytes,
            content_type="image/jpeg",
        )
    except Exception as e:  # noqa: BLE001
        raise TransientError(f"S3 upload failed: {e}") from e

    log.info(
        "cover_job_done",
        draft_id=draft_id,
        cover_key=output_key,
        thumbnail_key=thumbnail_key,
        cover_size=len(cover_bytes),
        thumb_size=len(thumb_bytes),
        cover_uri=cover_uri,
        thumb_uri=thumb_uri,
        request_id=request_id,
    )


def register() -> None:
    register_handler("format.cover", handle_cover_job)