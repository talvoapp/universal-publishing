"""
Pandoc adapter — converts Markdown (or Pandoc JSON) to PDF/EPUB/DOCX.

We use `pypandoc` (thin wrapper around the `pandoc` binary). PDF
rendering uses an HTML → WeasyPrint pipeline (via Pandoc's HTML output
+ our own CSS template) for the best typographic quality.

Design notes:
    - Each format has its own code path because Pandoc's options differ.
    - All conversions run with a hard timeout.
    - Output is returned as bytes (uploaded to S3 by the worker).
"""

from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path

import pypandoc

from app.config import settings
from app.utils.logger import get_logger
from app.utils.retry import retry_network


log = get_logger(__name__)


# ------------------------------------------------------------
# Pandoc binary presence check
# ------------------------------------------------------------
def ensure_pandoc_available() -> None:
    """Raise a clear error if `pandoc` is not on PATH."""
    try:
        version = pypandoc.get_pandoc_version()
        log.info("pandoc_available", version=version)
    except OSError as e:
        raise RuntimeError(
            f"pandoc binary not found at '{settings.pandoc_binary}'. "
            "Install Pandoc or set PANDOC_BINARY."
        ) from e


# ------------------------------------------------------------
# Core conversion
# ------------------------------------------------------------
def _run_pandoc(args: list[str], timeout_s: int | None = None) -> bytes:
    """Run pandoc directly and return stdout bytes."""
    timeout = timeout_s or settings.conversion_timeout_seconds
    try:
        proc = subprocess.run(
            [settings.pandoc_binary, *args],
            capture_output=True,
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired as e:
        raise TimeoutError(
            f"Pandoc timed out after {timeout}s"
        ) from e

    if proc.returncode != 0:
        stderr = proc.stderr.decode("utf-8", errors="replace")
        raise RuntimeError(
            f"Pandoc failed (exit {proc.returncode}): {stderr[:1000]}"
        )
    return proc.stdout


# ------------------------------------------------------------
# Format-specific converters
# ------------------------------------------------------------
@retry_network()
def markdown_to_html(markdown_text: str) -> str:
    """Markdown → HTML (used as an intermediate for PDF)."""
    html = pypandoc.convert_text(
        markdown_text,
        to="html5",
        format="markdown",
        extra_args=[
            "--standalone",
            "--highlight-style=tango",
            "--metadata", "lang=en",
        ],
    )
    return html


def markdown_to_pdf(
    markdown_text: str,
    title: str,
    author: str,
    html_template: str | None = None,
) -> bytes:
    """
    Markdown → PDF via Pandoc (HTML) → WeasyPrint.

    If `html_template` is provided, it must contain the full standalone
    HTML (with CSS inlined). Otherwise we generate a default one.
    """
    from weasyprint import HTML  # local import — heavy

    html = html_template or _build_html_wrapper(
        markdown_to_html(markdown_text),
        title=title,
        author=author,
    )
    pdf_bytes = HTML(string=html, base_url=settings.weasyprint_base_url or None).write_pdf()
    log.info("pdf_generated", size_bytes=len(pdf_bytes), title=title)
    return pdf_bytes


def markdown_to_epub(
    markdown_text: str,
    title: str,
    author: str,
    cover_image_path: str | None = None,
) -> bytes:
    """
    Markdown → EPUB via Pandoc (with metadata + optional cover).
    """
    with tempfile.TemporaryDirectory() as tmpdir:
        input_md = Path(tmpdir) / "input.md"
        output_epub = Path(tmpdir) / "output.epub"
        input_md.write_text(markdown_text, encoding="utf-8")

        args = [
            str(input_md),
            "-f", "markdown",
            "-t", "epub3",
            "-o", str(output_epub),
            "--toc",
            "--toc-depth=2",
            "--metadata", f"title={title}",
            "--metadata", f"author={author}",
            "--metadata", "lang=en",
        ]
        if cover_image_path:
            args.extend(["--epub-cover-image", cover_image_path])

        _run_pandoc(args)
        epub_bytes = output_epub.read_bytes()
        log.info("epub_generated", size_bytes=len(epub_bytes), title=title)
        return epub_bytes


def markdown_to_docx(
    markdown_text: str,
    title: str,
    author: str,
) -> bytes:
    """Markdown → DOCX via Pandoc."""
    with tempfile.TemporaryDirectory() as tmpdir:
        input_md = Path(tmpdir) / "input.md"
        output_docx = Path(tmpdir) / "output.docx"
        input_md.write_text(markdown_text, encoding="utf-8")

        _run_pandoc(
            [
                str(input_md),
                "-f", "markdown",
                "-t", "docx",
                "-o", str(output_docx),
                "--toc",
                "--metadata", f"title={title}",
                "--metadata", f"author={author}",
            ]
        )
        docx_bytes = output_docx.read_bytes()
        log.info("docx_generated", size_bytes=len(docx_bytes), title=title)
        return docx_bytes


# ------------------------------------------------------------
# HTML wrapper (for PDF)
# ------------------------------------------------------------
def _build_html_wrapper(body_html: str, title: str, author: str) -> str:
    """Wrap the Pandoc HTML body in a printable template."""
    from html import escape  # noqa: PLC0415

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>{escape(title)}</title>
  <style>
    @page {{
      size: {settings.pdf_page_size};
      margin: {settings.pdf_margin_mm}mm;
    }}
    body {{
      font-family: Georgia, 'Times New Roman', serif;
      line-height: 1.6;
      color: #1a1a1a;
      font-size: 11pt;
    }}
    h1, h2, h3, h4 {{
      font-family: 'Helvetica Neue', Arial, sans-serif;
      page-break-after: avoid;
    }}
    h1 {{ font-size: 24pt; margin-top: 0; }}
    h2 {{ font-size: 18pt; margin-top: 2em; }}
    h3 {{ font-size: 14pt; margin-top: 1.5em; }}
    p {{ margin: 0 0 1em 0; text-align: justify; hyphens: auto; }}
    blockquote {{
      border-left: 3px solid #888;
      margin-left: 0;
      padding-left: 1em;
      color: #555;
      font-style: italic;
    }}
    pre, code {{
      font-family: 'Courier New', monospace;
      font-size: 9pt;
      background: #f5f5f5;
      padding: 0.2em 0.4em;
      border-radius: 2px;
    }}
    pre {{
      padding: 1em;
      overflow-x: auto;
      page-break-inside: avoid;
    }}
    table {{
      border-collapse: collapse;
      width: 100%;
      margin: 1em 0;
    }}
    th, td {{
      border: 1px solid #ccc;
      padding: 0.5em;
      text-align: left;
    }}
    img {{ max-width: 100%; height: auto; }}
    hr {{ border: 0; border-top: 1px solid #ccc; margin: 2em 0; }}
    .cover-page {{
      text-align: center;
      page-break-after: always;
      padding-top: 30%;
    }}
    .cover-page h1 {{ font-size: 32pt; }}
    .cover-page .author {{ font-size: 14pt; color: #666; margin-top: 2em; }}
  </style>
</head>
<body>
  <div class="cover-page">
    <h1>{escape(title)}</h1>
    <div class="author">{escape(author)}</div>
  </div>
  {body_html}
</body>
</html>"""