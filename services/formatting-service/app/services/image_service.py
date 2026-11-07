"""
Image adapter — compression, thumbnails, format normalization.

All outputs go through Pillow for consistent, web-safe results.
"""

from __future__ import annotations

import io
from typing import Literal

from PIL import Image, ImageOps

from app.config import settings
from app.utils.logger import get_logger


log = get_logger(__name__)


ImageFormat = Literal["JPEG", "PNG", "WEBP"]


# ------------------------------------------------------------
# Normalize
# ------------------------------------------------------------
def normalize_image(data: bytes, max_dimension: int = 2000) -> bytes:
    """
    Re-encode any input image as a normalized JPEG:
    - EXIF-rotate
    - Convert to RGB
    - Downscale if larger than `max_dimension` on either axis
    - Optimize for size
    """
    with Image.open(io.BytesIO(data)) as img:
        img = ImageOps.exif_transpose(img)
        if img.mode != "RGB":
            img = img.convert("RGB")

        w, h = img.size
        if max(w, h) > max_dimension:
            scale = max_dimension / max(w, h)
            new_size = (int(w * scale), int(h * scale))
            img = img.resize(new_size, Image.LANCZOS)

        out = io.BytesIO()
        img.save(out, format="JPEG", quality=85, optimize=True, progressive=True)
        result = out.getvalue()
        log.info(
            "image_normalized",
            input_bytes=len(data),
            output_bytes=len(result),
            original_size=(w, h),
        )
        return result


# ------------------------------------------------------------
# Thumbnail
# ------------------------------------------------------------
def make_thumbnail(
    data: bytes,
    width: int | None = None,
    height: int | None = None,
    fmt: ImageFormat = "JPEG",
) -> bytes:
    """
    Generate a cover thumbnail. Preserves aspect ratio; crops to fill
    the target box (like CSS object-fit: cover).
    """
    target_w = width or settings.cover_thumbnail_width
    target_h = height or settings.cover_thumbnail_height

    with Image.open(io.BytesIO(data)) as img:
        img = ImageOps.exif_transpose(img)
        if img.mode not in ("RGB", "RGBA"):
            img = img.convert("RGB")

        # Resize to fill, then center-crop
        resized = ImageOps.fit(
            img,
            (target_w, target_h),
            method=Image.LANCZOS,
            centering=(0.5, 0.5),
        )

        out = io.BytesIO()
        if fmt == "JPEG":
            # JPEG doesn't support alpha — flatten on white
            if resized.mode == "RGBA":
                bg = Image.new("RGB", resized.size, (255, 255, 255))
                bg.paste(resized, mask=resized.split()[-1])
                resized = bg
            resized.save(out, format="JPEG", quality=85, optimize=True)
        elif fmt == "PNG":
            resized.save(out, format="PNG", optimize=True)
        elif fmt == "WEBP":
            resized.save(out, format="WEBP", quality=85, method=6)
        else:
            raise ValueError(f"Unsupported format: {fmt}")

        result = out.getvalue()
        log.info(
            "thumbnail_generated",
            target_size=(target_w, target_h),
            output_bytes=len(result),
            format=fmt,
        )
        return result


# ------------------------------------------------------------
# SVG → PNG (for cover thumbnails from vector sources)
# ------------------------------------------------------------
def svg_to_png(svg_data: bytes, width: int = 400, height: int = 600) -> bytes:
    """Rasterize an SVG for use as a cover thumbnail."""
    import cairosvg  # local import — heavy

    return cairosvg.svg2png(
        bytestring=svg_data,
        output_width=width,
        output_height=height,
    )