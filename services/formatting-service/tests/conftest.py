"""
Pytest configuration — imports all fixtures from setup.py so they
are auto-discovered by test files.

This is the standard pattern: pytest loads `conftest.py` automatically,
and any fixtures it imports become available to all tests in the
directory.
"""

from __future__ import annotations

# Import all fixtures from setup.py — they become available to all tests
from tests.setup import (  # noqa: F401
    sample_markdown,
    sample_job_payload,
    sample_image_bytes,
    sample_svg_bytes,
    fake_s3,
    fake_pandoc,
    reset_handlers,
)


# ============================================================
# ROOT FIXTURES (used by multiple test modules)
# ============================================================
import pytest


@pytest.fixture(scope="session")
def anyio_backend():
    """AnyIO backend for async tests (if we add any)."""
    return "asyncio"


@pytest.fixture(autouse=True)
def _isolate_env(monkeypatch):
    """
    Ensure each test starts with a known env baseline.
    Prevents cross-test contamination from previous tests that
    modify settings via monkeypatch.
    """
    monkeypatch.setenv("NODE_ENV", "test")
    monkeypatch.setenv("LOG_LEVEL", "silent")
    yield