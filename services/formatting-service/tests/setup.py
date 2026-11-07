"""
Pytest shared fixtures + module-level setup.

Uses `pytest.fixture` for:
    - Fake S3 (monkeypatched)
    - Fake RabbitMQ (not needed — workers tested directly)
    - Sample markdown payloads
"""

from __future__ import annotations

import io
from typing import Any

import pytest
from PIL import Image


# ============================================================
# SAMPLE DATA
# ============================================================
@pytest.fixture
def sample_markdown() -> str:
    return """# The Test Book

## Chapter 1: Beginnings

It was a dark and stormy night. The rain fell in torrents — except
at occasional intervals, when it was checked by a violent gust of wind.

> "This is a quote from someone wise."

### Subsection

- First bullet
- Second bullet
- Third bullet

1. First ordered
2. Second ordered

```python
def hello():
    return "world"
```

| Column A | Column B |
|----------|----------|
| Value 1  | Value 2  |
| Value 3  | Value 4  |

**Bold text** and *italic text* and `inline code`.

[Link to somewhere](https://example.com)
"""


@pytest.fixture
def sample_job_payload(sample_markdown: str) -> dict[str, Any]:
    return {
        "jobType": "format.pdf",
        "draftId": "11111111-1111-1111-1111-111111111111",
        "title": "The Test Book",
        "author": "Test Author",
        "content": sample_markdown,
        "outputKey": "drafts/test-id/export.pdf",
        "requestId": "req-test-123",
    }


@pytest.fixture
def sample_image_bytes() -> bytes:
    """A 100x150 PNG image."""
    img = Image.new("RGB", (100, 150), color=(28, 46, 74))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


@pytest.fixture
def sample_svg_bytes() -> bytes:
    """A tiny valid SVG."""
    return b"""<svg xmlns="http://www.w3.org/2000/svg" width="100" height="150">
      <rect width="100%" height="100%" fill="#1c2e4a"/>
      <text x="50%" y="50%" fill="#f5e6c8" text-anchor="middle">Test</text>
    </svg>"""


# ============================================================
# MOCKS
# ============================================================
@pytest.fixture
def fake_s3(monkeypatch):
    """Replace S3Service with an in-memory fake."""
    from app.services import s3_service

    class FakeS3:
        def __init__(self):
            self.storage: dict[str, bytes] = {}
            self.uploads: list[tuple[str, int, str]] = []

        def ensure_bucket(self) -> None:
            pass

        def head_bucket(self) -> None:
            pass

        def upload_file(self, key: str, data: bytes, content_type: str) -> str:
            body = data if isinstance(data, (bytes, bytearray)) else data.read()
            self.storage[key] = body
            self.uploads.append((key, len(body), content_type))
            return f"s3://test-bucket/{key}"

        def download_bytes(self, key: str) -> bytes:
            return self.storage[key]

        def generate_presigned_download_url(self, key: str, expires_in: int = 3600) -> str:
            return f"https://fake-s3/{key}?expires={expires_in}"

    fake = FakeS3()
    monkeypatch.setattr(s3_service, "S3Service", lambda: fake)
    return fake


@pytest.fixture
def fake_pandoc(monkeypatch):
    """Replace pandoc_service with stubs that return known bytes."""
    from app.services import pandoc_service

    def _markdown_to_pdf(markdown_text: str, title: str, author: str, html_template=None) -> bytes:
        return b"%PDF-1.4\n%" + title.encode()

    def _markdown_to_epub(markdown_text: str, title: str, author: str, cover_image_path=None) -> bytes:
        return b"PK\x03\x04" + title.encode()

    def _markdown_to_docx(markdown_text: str, title: str, author: str) -> bytes:
        return b"PK\x03\x04docx" + title.encode()

    monkeypatch.setattr(pandoc_service, "markdown_to_pdf", _markdown_to_pdf)
    monkeypatch.setattr(pandoc_service, "markdown_to_epub", _markdown_to_epub)
    monkeypatch.setattr(pandoc_service, "markdown_to_docx", _markdown_to_docx)


@pytest.fixture
def reset_handlers():
    """Clear the consumer's handler registry between tests."""
    from app import consumer
    consumer._registry.clear()
    yield
    consumer._registry.clear()


# ============================================================
# PYTEST HOOKS
# ============================================================
def pytest_collection_modifyitems(config, items):
    """Auto-mark slow tests."""
    for item in items:
        if "slow" in item.keywords:
            item.add_marker(pytest.mark.slow)
