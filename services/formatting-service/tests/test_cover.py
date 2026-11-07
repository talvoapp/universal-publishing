"""
Tests for image_service + dalle_service (cover generation).
"""

from __future__ import annotations

import io

import pytest
from PIL import Image

from app.services import image_service, dalle_service


# ============================================================
# IMAGE SERVICE
# ============================================================
class TestNormalizeImage:
    def test_reduces_large_image(self, sample_image_bytes):
        # Create a 3000x3000 image
        img = Image.new("RGB", (3000, 3000), (100, 100, 100))
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        result = image_service.normalize_image(buf.getvalue(), max_dimension=1000)

        out_img = Image.open(io.BytesIO(result))
        assert max(out_img.size) <= 1000
        assert len(result) < len(buf.getvalue())  # JPEG smaller than raw PNG

    def test_converts_to_rgb(self):
        img = Image.new("P", (100, 100))  # palette mode
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        result = image_service.normalize_image(buf.getvalue())
        out_img = Image.open(io.BytesIO(result))
        assert out_img.mode == "RGB"

    def test_handles_rgba_png(self):
        img = Image.new("RGBA", (100, 100), (255, 0, 0, 128))
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        result = image_service.normalize_image(buf.getvalue())
        assert result[:2] == b"\xff\xd8"  # JPEG magic


class TestMakeThumbnail:
    def test_creates_correct_dimensions(self, sample_image_bytes):
        thumb = image_service.make_thumbnail(sample_image_bytes, width=200, height=300)
        img = Image.open(io.BytesIO(thumb))
        assert img.size == (200, 300)

    def test_crops_to_fill(self):
        # Wide image → crop to tall thumbnail
        wide = Image.new("RGB", (1000, 200), (255, 0, 0))
        buf = io.BytesIO()
        wide.save(buf, format="PNG")
        thumb = image_service.make_thumbnail(buf.getvalue(), width=100, height=300)
        img = Image.open(io.BytesIO(thumb))
        assert img.size == (100, 300)

    def test_uses_config_defaults_when_unspecified(self, sample_image_bytes):
        from app.config import settings
        thumb = image_service.make_thumbnail(sample_image_bytes)
        img = Image.open(io.BytesIO(thumb))
        assert img.size == (settings.cover_thumbnail_width, settings.cover_thumbnail_height)


class TestSvgToPng:
    def test_rasterizes_svg(self, sample_svg_bytes):
        png = image_service.svg_to_png(sample_svg_bytes, width=200, height=300)
        assert png[:8] == b"\x89PNG\r\n\x1a\n"
        img = Image.open(io.BytesIO(png))
        assert img.size == (200, 300)


# ============================================================
# DALL-E SERVICE
# ============================================================
class TestPlaceholderCover:
    def test_generates_valid_jpeg(self):
        cover = dalle_service.generate_placeholder_cover(
            title="Test Book", author="Test Author"
        )
        img = Image.open(io.BytesIO(cover))
        assert img.format == "JPEG"
        assert img.size == (1200, 1800)

    def test_handles_long_title(self):
        long_title = "A Very Long Title " * 10
        cover = dalle_service.generate_placeholder_cover(
            title=long_title, author="Author"
        )
        assert cover[:2] == b"\xff\xd8"

    def test_handles_unicode_title(self):
        cover = dalle_service.generate_placeholder_cover(
            title="كتاب الاختبار", author="مؤلف الاختبار"
        )
        assert cover[:2] == b"\xff\xd8"


class TestDalleGeneration:
    def test_returns_none_without_api_key(self, monkeypatch):
        from app.config import settings
        monkeypatch.setattr(settings, "openai_api_key", None)
        result = dalle_service.generate_cover("a magical forest")
        assert result is None

    @pytest.mark.slow
    def test_handles_api_error_gracefully(self, monkeypatch):
        """With a fake key, real API rejects → returns None (not raise)."""
        from app.config import settings
        monkeypatch.setattr(settings, "openai_api_key", "sk-invalid-test-key")

        # httpx mock is heavy; the point of this test is that we NEVER raise
        # from generate_cover (always return None on failure).
        result = dalle_service.generate_cover("test prompt")
        assert result is None