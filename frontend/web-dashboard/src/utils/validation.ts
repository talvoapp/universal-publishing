/**
 * Client-side validation schemas (Zod).
 *
 * These mirror the server-side schemas in auth-service. Keep in sync.
 */

import { z } from 'zod';

// ============================================================
// PRIMITIVES
// ============================================================
export const emailSchema = z
  .string()
  .min(1, 'Email is required')
  .email('Invalid email address')
  .max(254);

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password too long')
  .regex(/[A-Za-z]/, 'Must contain at least one letter')
  .regex(/[0-9]/, 'Must contain at least one digit');

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, 'Display name is required')
  .max(80, 'Display name too long');

// ============================================================
// AUTH
// ============================================================
export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required'),
});

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: displayNameSchema,
});

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: passwordSchema,
});

// ============================================================
// DRAFT
// ============================================================
export const createDraftSchema = z.object({
  title: z.string().trim().max(500).optional(),
  contentType: z.enum(['article', 'book', 'news_post']),
  language: z.string().regex(/^[a-z]{2}-[A-Z]{2}$/).optional(),
});

export const updateDraftSchema = z.object({
  title: z.string().trim().min(1).max(500).optional(),
  language: z.string().regex(/^[a-z]{2}-[A-Z]{2}$/).optional(),
  metadata: z.record(z.unknown()).optional(),
});

// ============================================================
// TYPES (for forms)
// ============================================================
export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type CreateDraftInput = z.infer<typeof createDraftSchema>;
export type UpdateDraftInput = z.infer<typeof updateDraftSchema>;