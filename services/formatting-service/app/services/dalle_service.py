"""
DALL-E adapter — cover image generation (optional feature).

Only used when the incoming job includes `generateCover: true` AND an
OpenAI API key is configured. Failures fall back to a generic placeholder
cover so that the rest of the job (PDF/EPUB/DOCX) still succeeds.
"""

from __future__ import annotations

import httpx

from app.config import settings
from app.utils.logger import get_logger
from app.utils.retry import retry_network


log = get_logger(__name__)


# ------------------------------------------------------------
# Generate
# ------------------------------------------------------------
@retry_network(max_attempts=3)
def generate_cover(prompt: str, size: str = "1024x1536") -> bytes | None:
    """
    Ask DALL-E to generate a cover image. Returns image bytes, or
    `None` on failure (callers must handle the fallback path).
    """
    if not settings.openai_api_key:
        log.info("dalle_skipped", reason="no_api_key")
        return None

    # Constrain the prompt to avoid policy issues.
    safe_prompt = (
        f"Professional book cover artwork, illustration only, no text. "
        f"Theme: {prompt[:400]}"
    )

    log.info("dalle_generating", prompt_len=len(safe_prompt), size=size)

    try:
        with httpx.Client(timeout=60.0) as client:
            resp = client.post(
                "https://api.openai.com/v1/images/generations",
                headers={
                    "Authorization": f"Bearer {settings.openai_api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": settings.dalle_model,
                    "prompt": safe_prompt,
                    "n": 1,
                    "size": size,
                    "response_format": "b64_json",
                    "quality": "standard",
                },
            )
        if resp.status_code == 400:
            # Prompt rejected by moderation — not retryable.
            log.warning("dalle_rejected", body=resp.text[:500])
            return None
        resp.raise_for_status()
        data = resp.json()
        b64 = data["data"][0]["b64_json"]
        import base64
        result = base64.b64decode(b64)
        log.info("dalle_generated", size_bytes=len(result))
        return result
    except httpx.HTTPError as e:
        log.warning("dalle_failed", error=str(e))
        return None


# ------------------------------------------------------------
# Placeholder cover (fallback)
# ------------------------------------------------------------
def generate_placeholder_cover(
    title: str,
    author: str,
    width: int = 1200,
    height: int = 1800,
) -> bytes:
    """
    Draw a simple typographic cover with Pillow. Used when DALL-E is
    unavailable or the job doesn't request AI generation.
    """
    from PIL import Image, ImageDraw, ImageFont
    import io
    import textwrap

    bg = (28, 46, 74)  # dark blue
    fg = (245, 230, 200)  # cream

    img = Image.new("RGB", (width, height), bg)
    draw = ImageDraw.Draw(img)

    # Try to load a system font; fall back to default
    try:
        title_font = ImageFont.truetype(
            "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf",
            size=int(width * 0.10),
        )
        author_font = ImageFont.truetype(
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            size=int(width * 0.045),
        )
    except OSError:
        title_font = ImageFont.load_default()
        author_font = ImageFont.load_default()

    # Title (wrapped, centered)
    wrapped = textwrap.fill(title, width=18)
    bbox = draw.multiline_textbbox((0, 0), wrapped, font=title_font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    draw.multiline_text(
        ((width - tw) / 2, (height - th) / 3),
        wrapped,
        font=title_font,
        fill=fg,
        align="center",
    )

    # Author (bottom)
    bbox2 = draw.textbbox((0, 0), author, font=author_font)
    aw = bbox2[2] - bbox2[0]
    draw.text(
        ((width - aw) / 2, height * 0.82),
        author,
        font=author_font,
        fill=fg,
    )

    # Thin top/bottom rules
    draw.line([(width * 0.15, height * 0.10), (width * 0.85, height * 0.10)],
              fill=fg, width=2)
    draw.line([(width * 0.15, height * 0.90), (width * 0.85, height * 0.90)],
              fill=fg, width=2)

    out = __import__("io").BytesIO()
    img.save(out, format="JPEG", quality=88, optimize=True)
    log.info("placeholder_cover_generated", size_bytes=len(out.getvalue()))
    return out.getvalue()