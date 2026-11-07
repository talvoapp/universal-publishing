"""
Templates package — HTML/CSS templates used by workers.

Templates are loaded by `importlib.resources` (Python 3.11+) or by
plain file reads via `Path(__file__).parent / "name"`. Marking this
directory as a package ensures `setuptools` includes the files in
the built wheel (see pyproject.toml `[tool.setuptools.package-data]`).

Files in this package:
    - pdf_template.html    : standalone HTML wrapper for PDF (WeasyPrint)
    - epub_css.css         : stylesheet for EPUB3 (e-readers)
    - cover_canvas.html    : HTML5 canvas designer (frontend mirror)
"""