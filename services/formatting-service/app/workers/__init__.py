"""
Workers package — registers all job handlers with the consumer.

Each worker module exports a `register()` function that calls
`consumer.register_handler(job_type, handler)`.

The main app calls these register_* functions during startup.
"""

from __future__ import annotations

from app.workers.pdf_worker import register as register_pdf_worker
from app.workers.epub_worker import register as register_epub_worker
from app.workers.docx_worker import register as register_docx_worker
from app.workers.cover_worker import register as register_cover_worker

__all__ = [
    "register_pdf_worker",
    "register_epub_worker",
    "register_docx_worker",
    "register_cover_worker",
]