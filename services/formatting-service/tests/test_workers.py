"""
Tests for the four job workers.

Uses `fake_s3` and `fake_pandoc` fixtures — no real S3 or pandoc binary needed.
"""

from __future__ import annotations

import pytest

from app.consumer import PermanentError
from app.workers import pdf_worker, epub_worker, docx_worker, cover_worker


# ============================================================
# PDF WORKER
# ============================================================
class TestPdfWorker:
    def test_happy_path(self, sample_job_payload, fake_s3, fake_pandoc):
        pdf_worker.handle_pdf_job(sample_job_payload)
        assert len(fake_s3.uploads) == 1
        key, size, ct = fake_s3.uploads[0]
        assert key == "drafts/test-id/export.pdf"
        assert ct == "application/pdf"
        assert size > 0

    def test_missing_draft_id_raises_permanent(self, sample_job_payload, fake_s3, fake_pandoc):
        payload = {**sample_job_payload, "draftId": None}
        with pytest.raises(PermanentError, match="Missing draftId"):
            pdf_worker.handle_pdf_job(payload)

    def test_empty_content_raises_permanent(self, sample_job_payload, fake_s3, fake_pandoc):
        payload = {**sample_job_payload, "content": "   "}
        with pytest.raises(PermanentError, match="Empty content"):
            pdf_worker.handle_pdf_job(payload)

    def test_oversized_content_raises_permanent(self, sample_job_payload, fake_s3, fake_pandoc):
        payload = {**sample_job_payload, "content": "x" * (11 * 1024 * 1024)}
        with pytest.raises(PermanentError, match="too large"):
            pdf_worker.handle_pdf_job(payload)


# ============================================================
# EPUB WORKER
# ============================================================
class TestEpubWorker:
    def test_happy_path(self, sample_job_payload, fake_s3, fake_pandoc):
        payload = {**sample_job_payload, "jobType": "format.epub", "outputKey": "drafts/test-id/export.epub"}
        epub_worker.handle_epub_job(payload)
        assert len(fake_s3.uploads) == 1
        key, _, ct = fake_s3.uploads[0]
        assert key.endswith(".epub")
        assert ct == "application/epub+zip"

    def test_with_cover(self, sample_job_payload, sample_image_bytes, fake_s3, fake_pandoc):
        # Pre-populate S3 with a cover
        fake_s3.storage["drafts/test-id/cover.jpg"] = sample_image_bytes
        payload = {
            **sample_job_payload,
            "jobType": "format.epub",
            "coverKey": "drafts/test-id/cover.jpg",
        }
        epub_worker.handle_epub_job(payload)
        assert len(fake_s3.uploads) == 1

    def test_missing_cover_doesnt_fail(self, sample_job_payload, fake_s3, fake_pandoc):
        payload = {**sample_job_payload, "coverKey": "missing/key.jpg"}
        epub_worker.handle_epub_job(payload)  # should succeed without cover


# ============================================================
# DOCX WORKER
# ============================================================
class TestDocxWorker:
    def test_happy_path(self, sample_job_payload, fake_s3, fake_pandoc):
        payload = {**sample_job_payload, "jobType": "format.docx", "outputKey": "drafts/test-id/export.docx"}
        docx_worker.handle_docx_job(payload)
        assert len(fake_s3.uploads) == 1
        _, _, ct = fake_s3.uploads[0]
        assert "wordprocessingml" in ct


# ============================================================
# COVER WORKER
# ============================================================
class TestCoverWorker:
    def test_placeholder_mode(self, sample_job_payload, fake_s3, monkeypatch):
        from app.services import dalle_service

        # Force placeholder mode by making DALL-E return None
        monkeypatch.setattr(dalle_service, "generate_cover", lambda **_: None)

        payload = {
            **sample_job_payload,
            "jobType": "format.cover",
            "generateCover": True,  # even with generateCover, DALL-E fails → placeholder
            "outputKey": "drafts/test-id/cover.jpg",
            "thumbnailKey": "drafts/test-id/cover-thumb.jpg",
        }
        cover_worker.handle_cover_job(payload)

        # Should upload 2 files: full cover + thumbnail
        assert len(fake_s3.uploads) == 2
        keys = [u[0] for u in fake_s3.uploads]
        assert "drafts/test-id/cover.jpg" in keys
        assert "drafts/test-id/cover-thumb.jpg" in keys

        # Verify both are JPEGs
        for _, _, ct in fake_s3.uploads:
            assert ct == "image/jpeg"

    def test_with_dalle_success(self, sample_job_payload, sample_image_bytes, fake_s3, monkeypatch):
        from app.services import dalle_service
        monkeypatch.setattr(dalle_service, "generate_cover", lambda **_: sample_image_bytes)

        payload = {
            **sample_job_payload,
            "jobType": "format.cover",
            "generateCover": True,
            "coverPrompt": "a magical forest at twilight",
            "outputKey": "drafts/test-id/cover.jpg",
            "thumbnailKey": "drafts/test-id/cover-thumb.jpg",
        }
        cover_worker.handle_cover_job(payload)
        assert len(fake_s3.uploads) == 2

    def test_missing_draft_id_raises_permanent(self, sample_job_payload, fake_s3):
        payload = {**sample_job_payload, "draftId": None, "jobType": "format.cover"}
        with pytest.raises(PermanentError):
            cover_worker.handle_cover_job(payload)