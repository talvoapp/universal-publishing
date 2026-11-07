# Formatting Service

Document conversion microservice for **Universal Publishing Platform**.

Transforms raw drafts (Markdown) into **PDF**, **EPUB3**, **DOCX**, and **book covers**. Fully asynchronous — driven by RabbitMQ jobs, not HTTP requests.

---

## 🎯 Responsibilities

| Job Type | Input | Output |
|---|---|---|
| `format.pdf` | Markdown + metadata | Print-quality PDF (WeasyPrint) |
| `format.epub` | Markdown + metadata (+ optional cover) | EPUB3 ebook |
| `format.docx` | Markdown + metadata | Editable Word document |
| `format.cover` | Title + author (+ optional AI prompt) | JPEG cover + 400×600 thumbnail |

---

## 🏗️ Architecture

```
       ┌─────────────────┐
       │  RabbitMQ       │  formatting.jobs
       │  (jobs queue)   │
       └────────┬────────┘
                │ AMQP
       ┌────────▼────────┐
       │ formatting-svc  │  (this)
       │  [worker only]  │
       └────────┬────────┘
                │
       ┌────────┼────────┐
       │        │        │
  ┌────▼───┐ ┌──▼────┐ ┌▼─────────┐
  │ Pandoc │ │Weasy  │ │ S3/MinIO │
  │ (bin)  │ │Print  │ │ (assets) │
  └────────┘ └───────┘ └──────────┘
```

**No user-facing API.** The only HTTP endpoints are `/health`, `/ready`, `/metrics` for Kubernetes probes.

---

## 📥 Job Format

### `format.pdf`

```json
{
  "jobType": "format.pdf",
  "draftId": "uuid",
  "title": "Book Title",
  "author": "Author Name",
  "content": "# Chapter 1\n\nMarkdown content...",
  "outputKey": "drafts/uuid/export.pdf",
  "requestId": "req-uuid"
}
```

### `format.epub`

Same as PDF, plus optional:
```json
{
  "coverKey": "drafts/uuid/cover.jpg"
}
```

### `format.docx`

Same as PDF (no cover).

### `format.cover`

```json
{
  "jobType": "format.cover",
  "draftId": "uuid",
  "title": "Book Title",
  "author": "Author Name",
  "generateCover": true,
  "coverPrompt": "a magical forest at twilight",
  "outputKey": "drafts/uuid/cover.jpg",
  "thumbnailKey": "drafts/uuid/cover-thumb.jpg",
  "requestId": "req-uuid"
}
```

If `generateCover: true` AND `OPENAI_API_KEY` is set → DALL-E. Otherwise (or on failure) → **Pillow-generated placeholder**. Either way, the job succeeds.

---

## 🔄 Retry & Failure Handling

| Situation | Behavior |
|---|---|
| Missing `draftId` | **Permanent** → NACK → DLQ |
| Empty content | **Permanent** → DLQ |
| Content > 10 MB | **Permanent** → DLQ |
| Pandoc conversion error | **Permanent** → DLQ |
| Pandoc timeout | **Transient** → republish with `x-retries+1` (max 3) |
| S3 upload failure | **Transient** → republish (max 3) |
| Uncaught exception | **Permanent** → DLQ (prevents infinite loop) |

Messages that exhaust retries go to `formatting.jobs.dlq`.

---

## 🚀 Running Locally

### Prerequisites

```bash
# Install Pandoc + WeasyPrint system deps
bash scripts/install_pandoc.sh

# Linux (Debian/Ubuntu) also needs:
sudo apt-get install -y \
  libpango-1.0-0 libpangoft2-1.0-0 libcairo2 \
  libgdk-pixbuf-2.0-0 fonts-dejavu-core
```

### Setup

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Edit .env with RabbitMQ + S3 endpoints
python -m app.main
```

Listens on `http://localhost:4008` (health only).

---

## 🧪 Testing

```bash
# Unit tests (no external deps)
pytest tests/test_pandoc.py tests/test_cover.py tests/test_workers.py tests/test_consumer.py

# Skip slow tests
pytest -m "not slow"

# With coverage
pytest --cov=app --cov-report=term-missing
```

Tests use mocked S3 (in-memory) and stubbed Pandoc, so **no external services are required** for the test suite.

Coverage thresholds: 65% global (enforced by `pyproject.toml`).

---

## 📦 Docker

```bash
docker build -t upp/formatting-service:latest .
docker run --env-file .env.production upp/formatting-service:latest
```

Image is ~600 MB due to system packages (pandoc, WeasyPrint deps). This is expected for a document-rendering worker.

Notes:
- Uses `tini` as PID 1 for graceful SIGTERM.
- Health check hits `/health` — the worker thread is checked via `/ready`.

---

## 📁 Directory Structure

```
app/
├── main.py             FastAPI app + lifespan
├── config.py           Pydantic settings
├── consumer.py         RabbitMQ consumer (blocking)
├── services/
│   ├── pandoc_service.py   MD → HTML/PDF/EPUB/DOCX
│   ├── s3_service.py       Upload/download/presigned
│   ├── image_service.py    Normalize/thumbnail/SVG→PNG
│   └── dalle_service.py    DALL-E + Pillow placeholder
├── workers/
│   ├── pdf_worker.py
│   ├── epub_worker.py
│   ├── docx_worker.py
│   └── cover_worker.py
├── templates/
│   ├── pdf_template.html
│   ├── epub_css.css
│   └── cover_canvas.html
└── utils/
    ├── logger.py          structlog
    └── retry.py           tenacity
```

---

## 🩺 Debugging

**"pandoc not found"**
→ `bash scripts/install_pandoc.sh` or `apt-get install pandoc`.

**"OSError: cannot load library 'libgobject-2.0'"**
→ WeasyPrint system deps missing. See "Prerequisites" above.

**Jobs pile up in DLQ**
→ Check the DLQ message headers (`x-retries`). Look at worker logs for `PermanentError` — usually invalid markdown or missing fields.

**Worker not consuming**
→ `curl http://localhost:4008/ready` — if `rabbitmq: fail`, the consumer thread crashed. Check logs for `consumer_crashed`.

---

## 📝 License

Proprietary — All rights reserved.