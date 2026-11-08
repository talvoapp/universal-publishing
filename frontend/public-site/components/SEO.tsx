/**
 * SEO — injects JSON-LD structured data.
 *
 * Usage:
 *   <SEO jsonLd={buildArticleJsonLd(article)} />
 */

interface SEOProps {
  jsonLd?: string;
}

export function SEO({ jsonLd }: SEOProps) {
  if (!jsonLd) return null;

  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: jsonLd }}
    />
  );
}