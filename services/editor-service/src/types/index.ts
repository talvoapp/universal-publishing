/**
 * Zod request schemas + inferred TS types for editor-service.
 *
 * Everything the HTTP API accepts goes through here. WebSocket frames
 * have their own schemas in `websocket/handler.ts` (kept separate
 * because they have different validation lifecycle: per-frame vs per-request).
 */

import { z } from 'zod';

// ============================================================
// PRIMITIVES
// ============================================================
const objectIdSchema = z
  .string()
  .regex(/^[a-f0-9]{24}$/i, 'Must be a 24-char hex MongoDB ObjectId');

const draftIdParamSchema = z.object({ id: objectIdSchema }).strict();

const versionParamSchema = z
  .object({
    id: objectIdSchema,
    version: z
      .string()
      .regex(/^\d+$/, 'Version must be a number')
      .transform((v) => parseInt(v, 10))
      .refine((n) => n >= 1, 'Version must be >= 1'),
  })
  .strict();

const languageSchema = z
  .string()
  .regex(/^[a-z]{2}-[A-Z]{2}$/, 'Language must be like "en-US"');

const tagSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[a-z0-9-]+$/, 'Tags may only contain lowercase letters, digits, and hyphens');

// ============================================================
// DRAFT CREATE
// ============================================================
export const createDraftSchema = z
  .object({
    title: z.string().trim().max(500).optional(),
    contentType: z.enum(['article', 'book', 'news_post']),
    language: languageSchema.optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();

export type CreateDraftInput = z.infer<typeof createDraftSchema>;

// ============================================================
// DRAFT UPDATE (metadata only — content goes via WebSocket)
// ============================================================
export const updateDraftSchema = z
  .object({
    title: z.string().trim().min(1).max(500).optional(),
    language: languageSchema.optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict()
  .refine(
    (v) => Object.keys(v).length > 0,
    'At least one field must be provided',
  );

export type UpdateDraftInput = z.infer<typeof updateDraftSchema>;

// ============================================================
// LIST QUERY
// ============================================================
export const listDraftsQuerySchema = z
  .object({
    status: z.enum(['draft', 'published', 'archived', 'all']).default('draft'),
    contentType: z.enum(['article', 'book', 'news_post']).optional(),
    cursor: z.string().min(1).max(128).optional(),
    limit: z
      .string()
      .regex(/^\d+$/)
      .transform((v) => parseInt(v, 10))
      .refine((n) => n >= 1 && n <= 100, 'limit must be 1..100')
      .default('20'),
  })
  .strict();

export type ListDraftsQuery = z.infer<typeof listDraftsQuerySchema>;

// ============================================================
// TAGS
// ============================================================
export const addTagsSchema = z
  .object({
    tags: z.array(tagSchema).min(1).max(20),
  })
  .strict();

export type AddTagsInput = z.infer<typeof addTagsSchema>;

// ============================================================
// VERSIONS
// ============================================================
export const listVersionsQuerySchema = z
  .object({
    cursor: z.string().min(1).max(128).optional(),
    limit: z
      .string()
      .regex(/^\d+$/)
      .transform((v) => parseInt(v, 10))
      .refine((n) => n >= 1 && n <= 100, 'limit must be 1..100')
      .default('20'),
  })
  .strict();

export const revertSchema = z
  .object({
    to_version: z
      .number()
      .int()
      .min(1, 'Version must be >= 1'),
  })
  .strict();

export type RevertInput = z.infer<typeof revertSchema>;

// ============================================================
// TAXONOMY
// ============================================================
export const searchTagsQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(50),
    limit: z
      .string()
      .regex(/^\d+$/)
      .transform((v) => parseInt(v, 10))
      .refine((n) => n >= 1 && n <= 50, 'limit must be 1..50')
      .default('10'),
  })
  .strict();

// ============================================================
// PARAM EXPORTS
// ============================================================
export { draftIdParamSchema, versionParamSchema };

// ============================================================
// ERROR TYPES (re-export for controllers)
// ============================================================
export interface FieldError {
  path: string;
  message: string;
  code: string;
}