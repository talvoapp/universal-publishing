
"""
Tests for pandoc_service — HTML/EPUB/DOCX conversion.

We do NOT test PDF here (WeasyPrint requires system libs and is slow).
PDF is tested in test_workers.py with a stub.
"""

from __future__ import annotations

import pytest

from app.services import pandoc_service


class TestMarkdownToHtml:
    def test_converts_basic_markdown(self):
        html = pandoc_service.markdown_to_html("# Hello\n\nWorld.")
        assert "<h1" in html
        assert "Hello" in html
        assert "<p>" in html
        assert "World." in html

    def test_handles_lists(self):
        md = "- a\n- b\n- c\n"
        html = pandoc_service.markdown_to_html(md)
        assert "<ul>" in html
        assert "<li>" in html

    def test_handles_code_blocks(self):
        md = "```python\nprint('hi')\n```\n"
        html = pandoc_service.markdown_to_html(md)
        assert "<pre" in html
        assert "<code" in html

    def test_handles_blockquotes(self):
        md = "> quoted text\n"
        html = pandoc_service.markdown_to_html(md)
        assert "<blockquote>" in html


class TestMarkdownToDocx:
    def test_produces_docx_bytes(self):
        docx = pandoc_service.markdown_to_docx(
            markdown_text="# Title\n\nBody text.",
            title="Test",
            author="Author",
        )
        assert docx.startswith(b"PK")  # DOCX = ZIP
        assert len(docx) > 1000


class TestMarkdownToEpub:
    def test_produces_epub_bytes(self):
        epub = pandoc_service.markdown_to_epub(
            markdown_text="# Title\n\nBody.",
            title="Test EPUB",
            author="Author",
        )
        assert epub.startswith(b"PK")
        assert len(epub) > 1000


class TestPandocAvailability:
    def test_ensure_pandoc_available(self):
        # Should not raise
        pandoc_service.ensure_pandoc_available()