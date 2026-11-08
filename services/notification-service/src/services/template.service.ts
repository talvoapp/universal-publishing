/**
 * Template service — Handlebars rendering with caching.
 *
 * Templates are read from `src/templates/` at first use, compiled,
 * and cached in memory. Layout (`layouts/base.hbs`) is applied
 * automatically to all email templates.
 */

import fs from 'fs/promises';
import path from 'path';
import Handlebars from 'handlebars';
import { createLogger } from '@/utils/logger';

const log = createLogger('template.service');

// ============================================================
// CONFIGURATION
// ============================================================
const TEMPLATE_DIR = path.resolve(__dirname, '..', 'templates');

// Cache: { "order-confirmation": { subject: ..., body: compiled } }
interface CompiledTemplate {
  subject: Handlebars.TemplateDelegate;
  body: Handlebars.TemplateDelegate;
  text: Handlebars.TemplateDelegate | null;
}

const cache = new Map<string, CompiledTemplate>();
let layoutCompiled: Handlebars.TemplateDelegate | null = null;
let helpersRegistered = false;

// ============================================================
// HELPERS
// ============================================================
function registerHelpers(): void {
  if (helpersRegistered) return;

  Handlebars.registerHelper('formatCurrency', (amount: string | number, currency: string) => {
    const num = typeof amount === 'string' ? parseFloat(amount) : amount;
    if (Number.isNaN(num)) return `${amount} ${currency}`;
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD',
    }).format(num);
  });

  Handlebars.registerHelper('eq', (a: unknown, b: unknown) => a === b);

  Handlebars.registerHelper('uppercase', (s: string) => String(s).toUpperCase());

  Handlebars.registerHelper('formatDate', (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    } catch {
      return iso;
    }
  });

  helpersRegistered = true;
}

// ============================================================
// LAYOUT
// ============================================================
async function loadLayout(): Promise<Handlebars.TemplateDelegate> {
  if (layoutCompiled) return layoutCompiled;

  const layoutPath = path.join(TEMPLATE_DIR, 'layouts', 'base.hbs');
  try {
    const source = await fs.readFile(layoutPath, 'utf-8');
    layoutCompiled = Handlebars.compile(source);
    log.debug({ path: layoutPath }, 'layout_loaded');
    return layoutCompiled;
  } catch (err) {
    log.warn({ err, path: layoutPath }, 'layout_load_failed_using_plain');
    // Fallback: no layout
    layoutCompiled = Handlebars.compile('{{{body}}}');
    return layoutCompiled;
  }
}

// ============================================================
// TEMPLATE LOADING
// ============================================================
async function loadTemplate(name: string): Promise<CompiledTemplate> {
  const cached = cache.get(name);
  if (cached) return cached;

  // Each template has 3 files: {name}.subject.hbs, {name}.html.hbs, {name}.text.hbs (optional)
  const subjectPath = path.join(TEMPLATE_DIR, `${name}.subject.hbs`);
  const htmlPath = path.join(TEMPLATE_DIR, `${name}.html.hbs`);
  const textPath = path.join(TEMPLATE_DIR, `${name}.text.hbs`);

  let subjectSource: string;
  let htmlSource: string;

  try {
    [subjectSource, htmlSource] = await Promise.all([
      fs.readFile(subjectPath, 'utf-8'),
      fs.readFile(htmlPath, 'utf-8'),
    ]);
  } catch (err) {
    throw new Error(`Template not found: ${name} (${(err as Error).message})`);
  }

  // Optional plain-text version
  let textSource: string | null = null;
  try {
    textSource = await fs.readFile(textPath, 'utf-8');
  } catch {
    // Not all templates have text versions
  }

  const compiled: CompiledTemplate = {
    subject: Handlebars.compile(subjectSource),
    body: Handlebars.compile(htmlSource),
    text: textSource ? Handlebars.compile(textSource) : null,
  };

  cache.set(name, compiled);
  log.debug({ name }, 'template_compiled');
  return compiled;
}

// ============================================================
// PUBLIC API
// ============================================================
export interface RenderedTemplate {
  subject: string;
  html: string;
  text: string;
}

export async function renderTemplate(
  templateName: string,
  variables: Record<string, unknown>,
): Promise<RenderedTemplate> {
  registerHelpers();

  const template = await loadTemplate(templateName);
  const layout = await loadLayout();

  const subject = template.subject(variables);
  const bodyHtml = template.body(variables);

  // Wrap in layout
  const html = layout({ ...variables, body: bodyHtml });

  // Plain text: either from {name}.text.hbs or a naive HTML strip
  const text = template.text
    ? template.text(variables)
    : stripHtml(bodyHtml);

  return { subject, html, text };
}

// ============================================================
// UTILITIES
// ============================================================
function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>.*?<\/style>/gis, '')
    .replace(/<script[^>]*>.*?<\/script>/gis, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// For tests — clear the cache
export function _clearTemplateCacheForTests(): void {
  cache.clear();
  layoutCompiled = null;
}