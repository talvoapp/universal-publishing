# Public Site

SEO-optimized public-facing website for **Universal Publishing Platform**.

Built with **Next.js 14** (App Router) + **React Server Components** + **Tailwind CSS**.

---

## 🎯 Purpose

| Page | Description |
|---|---|
| `/` | Homepage — hero + featured feed |
| `/article/[slug]` | Article preview (paywalled full content) |
| `/book/[id]` | Book page with TOC |
| `/author/[id]` | Author profile + posts |
| `/category/[slug]` | Category listing |
| `/search?q=` | Search results |
| `/privacy`, `/terms`, `/dmca` | Legal pages |

All article pages use **SSR** with `generateMetadata` for optimal SEO.

---

## 🏗️ Architecture

```
       ┌──────────────────┐
       │ Browser          │
       └────────┬─────────┘
                │
       ┌────────▼──────────┐
       │ Next.js (SSR)     │  ISR: 60s
       │ + Server Components│
       └────────┬──────────┘
                │ fetch
       ┌────────▼──────────┐
       │ API Gateway       │  http://localhost:8080
       └────────┬──────────┘
                │
       ┌────────▼──────────┐
       │ content-service   │
       │ + feed-service    │
       └───────────────────┘
```

**Key decisions:**
- **Server Components** — no client JS for content rendering
- **ISR (Incremental Static Regeneration)** — content cached, refreshed every 60s
- **`revalidate` + `tags`** — granular cache invalidation
- **`generateMetadata`** — per-page OG tags + JSON-LD
- **`sitemap.ts` + `robots.ts`** — SEO-friendly

---

## 🔐 SEO Features

### Per-page metadata
```typescript
export async function generateMetadata({ params }) {
  const article = await getArticleMetadata(params.slug);
  return buildArticleMetadata(article);
}
```

### OpenGraph tags
- `og:type`, `og:title`, `og:description`, `og:image`
- `og:site_name`, `og:locale`
- `article:published_time`, `article:tag`

### Twitter Cards
- `summary_large_image` with image

### JSON-LD Structured Data
```json
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "...",
  "url": "...",
  "image": "...",
  "datePublished": "...",
  "wordCount": 5000,
  "inLanguage": "en-US"
}
```

### Sitemap
Dynamic `/sitemap.xml` generated from the feed — all published articles are listed.

### Robots
- All pages indexable except `/search?q=`
- Sitemap auto-linked

---

## 🚀 Running Locally

### Prerequisites
- Node.js 20+
- API Gateway running at `http://localhost:8080`

### Setup

```bash
cd frontend/public-site
cp .env.example .env
npm install
npm run dev
```

Listens on **http://localhost:3001**.

### Env variables

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_API_URL` | API Gateway URL (default: `http://localhost:8080`) |
| `NEXT_PUBLIC_SITE_URL` | Canonical site URL (default: `http://localhost:3001`) |
| `NEXT_PUBLIC_SITE_NAME` | Site name for OG tags |
| `NEXT_PUBLIC_DEFAULT_OG_IMAGE` | Fallback OG image |

---

## 🧪 Testing

```bash
npm run typecheck  # TypeScript check
npm run lint       # ESLint
```

---

## 📦 Docker

```bash
docker build \
  --build-arg NEXT_PUBLIC_API_URL=http://localhost:8080 \
  --build-arg NEXT_PUBLIC_SITE_URL=http://localhost:3001 \
  -t upp/public-site:latest .

docker run --env-file .env.production -p 3001:3001 upp/public-site:latest
```

**Image size**: ~150 MB (Next.js standalone is optimized).

**Note**: Uses `output: 'standalone'` in `next.config.js` — required for the minimal runtime image.

---

## 📁 Directory Structure

```
app/
├── layout.tsx              Root layout (Navbar + Footer)
├── page.tsx                Homepage (feed)
├── globals.css             Tailwind + article prose
├── loading.tsx             Skeleton loader
├── error.tsx               Error boundary
├── not-found.tsx           404 page
├── robots.ts               robots.txt generator
├── sitemap.ts              sitemap.xml generator
├── article/[slug]/page.tsx Article preview (SSR)
├── book/[id]/page.tsx      Book page (TOC)
├── author/[id]/page.tsx    Author profile
├── category/[slug]/page.tsx Category listing
├── search/page.tsx         Search results
├── privacy/page.tsx        Privacy policy
├── terms/page.tsx          Terms of service
├── dmca/page.tsx           DMCA policy
└── api/health/route.ts     Health check

components/
├── Navbar.tsx              Sticky top nav
├── Footer.tsx              Multi-column footer
├── ArticleCard.tsx         Article card
├── AuthorCard.tsx          Author card
└── SEO.tsx                 JSON-LD injector

lib/
├── api.ts                  Server-side fetch helpers
├── types.ts                TypeScript types
├── metadata.ts             OG + JSON-LD builders
└── format.ts               Date/currency formatting
```

---

## 🩺 Debugging

**"Article not found"**
→ Check `content-service` is running and the item is published in MongoDB.

**Images not loading**
→ Check `next.config.js` `remotePatterns` includes the image host.

**Sitemap missing articles**
→ `/sitemap.xml` is generated from the feed. Ensure `feed-service` returns recent posts.

**Build fails with "Cannot find module"**
→ Delete `.next/` and `node_modules/`, then `npm ci && npm run build`.

**Slow build times**
→ Next.js builds are slow. Consider `--turbopack` (experimental) or parallelizing.

---

## 📈 Performance

- **ISR**: articles cached for 60s (adjustable per page)
- **Image optimization**: `next/image` with automatic formats
- **Static rendering**: homepage + static pages
- **Streaming SSR**: `loading.tsx` shows skeleton during server fetch
- **Edge-ready**: deploy to Vercel, Cloudflare Pages, or any Node.js host

---

## 📝 License

Proprietary — All rights reserved.