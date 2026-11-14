/**
 * User profile controller.
 *
 * Two public-read endpoints:
 *   - GET /users/:id         → public-facing profile (no email)
 *   - GET /users/:id/public  → internal — includes email (for notification-service)
 *
 * The latter is called server-to-server by notification-service to
 * resolve recipient emails. It should be rate-limited and/or
 * IP-allowlisted at the ingress layer (nginx / Cloudflare).
 */

import type { Request, Response } from 'express';
import * as userService from '@/services/user.service';
import { getCurrentUser } from '@/middleware/auth.middleware';

// ============================================================
// GET /users/me
// ============================================================
export async function getMe(req: Request, res: Response): Promise<void> {
  const user = getCurrentUser(req);
  const result = await userService.getMe(user.id);
  res.status(200).json({ user: result });
}

// ============================================================
// PATCH /users/me
// ============================================================
export async function updateMe(req: Request, res: Response): Promise<void> {
  const user = getCurrentUser(req);
  const updates = req.body as {
    displayName?: string;
    bio?: string;
    avatarUrl?: string;
    language?: string;
  };
  const result = await userService.updateMe(user.id, updates);
  res.status(200).json({ user: result });
}

// ============================================================
// POST /users/me/change-password
// ============================================================
export async function changePassword(
  req: Request,
  res: Response,
): Promise<void> {
  const user = getCurrentUser(req);
  const { currentPassword, newPassword } = req.body as {
    currentPassword: string;
    newPassword: string;
  };
  await userService.changePassword({
    userId: user.id,
    currentPassword,
    newPassword,
    requestId: String(req.id),   // ← إصلاح: ReqId → string
  });
  res.status(200).json({
    message: 'Password changed. All other sessions have been logged out.',
  });
}

// ============================================================
// DELETE /users/me
// ============================================================
export async function deleteMe(req: Request, res: Response): Promise<void> {
  const user = getCurrentUser(req);
  const { password, confirmPhrase } = req.body as {
    password: string;
    confirmPhrase: string;
  };
  await userService.scheduleDeletion({
    userId: user.id,
    password,
    confirmPhrase,
    requestId: String(req.id),   // ← إصلاح: ReqId → string
  });
  res.status(202).json({
    message: 'Account scheduled for deletion. You have been logged out.',
  });
}

// ============================================================
// GET /users/:id  (public profile)
//
// Strips `email` from the response — this is the end-user-facing
// endpoint and should never leak email addresses.
// ============================================================
export async function getPublicProfile(
  req: Request,
  res: Response,
): Promise<void> {
  const { id } = req.params as { id: string };
  const profile = await userService.getPublicProfile(id);

  // Strip email for the public-facing endpoint.
  const { email: _email, ...publicProfile } = profile;
  res.status(200).json({ user: publicProfile });
}

// ============================================================
// GET /users/:id/public  (internal — for notification-service)
//
// Returns the FULL profile record INCLUDING `email`. This endpoint
// is called server-to-server by notification-service. Protect it
// at the ingress layer (rate limit / IP allowlist).
// ============================================================
export async function getPublicProfileWithEmail(
  req: Request,
  res: Response,
): Promise<void> {
  const { id } = req.params as { id: string };
  const profile = await userService.getPublicProfile(id);
  res.status(200).json({ user: profile });
}