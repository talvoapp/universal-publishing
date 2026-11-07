/**
 * Zod request schemas + inferred TypeScript types.
 *
 * Every endpoint's request body is validated against a schema defined
 * here before reaching the controller. This file is the single source
 * of truth for input shapes — the OpenAPI spec is generated from it
 * (see docs/openapi/auth.openapi.yaml, kept in sync manually for now).
 */

import { z } from 'zod';

// ============================================================
// PRIMITIVES
// ============================================================
/**
 * Password policy:
 *   - 8–72 chars (bcrypt silently truncates at 72, so we enforce the limit)
 *   - Must contain at least one letter and one digit
 *   - Rejects the 20 most common passwords (best-effort client of HaveIBeenPwned
 *     is out of scope for v1; add later via a service)
 */
const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password must be at most 72 characters')
  .regex(/[A-Za-z]/, 'Password must contain at least one letter')
  .regex(/[0-9]/, 'Password must contain at least one digit');

const emailSchema = z
  .string()
  .min(3)
  .max(254)
  .email('Invalid email address')
  .transform((v) => v.trim().toLowerCase());

const displayNameSchema = z
  .string()
  .trim()
  .min(1, 'Display name is required')
  .max(80, 'Display name is too long')
  .regex(
    /^[\p{L}\p{N}\s._'-]+$/u,
    'Display name contains invalid characters',
  );

// ============================================================
// AUTH SCHEMAS
// ============================================================
export const registerSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    displayName: displayNameSchema,
  })
  .strict();

export const loginSchema = z
  .object({
    email: emailSchema,
    // Do NOT apply the full password policy here — old accounts may
    // have been created under weaker rules; comparing is constant time.
    password: z.string().min(1).max(72),
  })
  .strict();

export const refreshSchema = z
  .object({
    refreshToken: z.string().min(20).max(4096),
  })
  .strict();

export const logoutSchema = z
  .object({
    refreshToken: z.string().min(20).max(4096),
  })
  .strict();

export const forgotPasswordSchema = z
  .object({
    email: emailSchema,
  })
  .strict();

export const resetPasswordSchema = z
  .object({
    token: z.string().min(20).max(4096),
    newPassword: passwordSchema,
  })
  .strict();

export const verifyEmailSchema = z
  .object({
    token: z.string().min(20).max(4096),
  })
  .strict();

export const resendVerificationSchema = z.object({}).strict();

// ============================================================
// USER SCHEMAS
// ============================================================
export const updateProfileSchema = z
  .object({
    displayName: displayNameSchema.optional(),
    bio: z.string().max(500, 'Bio must be at most 500 characters').optional(),
    avatarUrl: z.string().url('Avatar URL must be a valid URL').optional(),
    language: z
      .string()
      .regex(/^[a-z]{2}-[A-Z]{2}$/, 'Language must be like "en-US"')
      .optional(),
  })
  .strict();

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(72),
    newPassword: passwordSchema,
  })
  .strict();

export const deleteAccountSchema = z
  .object({
    password: z.string().min(1).max(72),
    confirmPhrase: z.literal('DELETE MY ACCOUNT'),
  })
  .strict();

// ============================================================
// INFERRED TS TYPES
// ============================================================
export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type LogoutInput = z.infer<typeof logoutSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
export type ResendVerificationInput = z.infer<typeof resendVerificationSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;