/**
 * User profile controller.
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
    requestId: req.id,
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
    requestId: req.id,
  });
  res.status(202).json({
    message: 'Account scheduled for deletion. You have been logged out.',
  });
}

// ============================================================
// GET /users/:id  (public profile)
// ============================================================
export async function getPublicProfile(
  req: Request,
  res: Response,
): Promise<void> {
  const { id } = req.params as { id: string };
  const profile = await userService.getPublicProfile(id);
  res.status(200).json({ user: profile });
}