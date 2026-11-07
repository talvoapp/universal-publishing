/**
 * Auth controller — thin layer between HTTP and services.
 *
 * Controllers:
 *   - Extract data from req (already validated by middleware)
 *   - Call exactly one service method
 *   - Return a consistent JSON response
 *
 * Business logic lives in services. Errors are thrown (not caught
 * here) and bubble up to the error middleware.
 */

import type { Request, Response } from 'express';
import * as authService from '@/services/auth.service';
import { getCurrentUser } from '@/middleware/auth.middleware';
import { config } from '@/config';

// ============================================================
// REGISTER
// ============================================================
export async function register(req: Request, res: Response): Promise<void> {
  const { email, password, displayName } = req.body as {
    email: string;
    password: string;
    displayName: string;
  };

  const result = await authService.register({
    email,
    password,
    displayName,
    requestId: req.id,
    ip: req.ip ?? 'unknown',
  });

  res.status(201).json({
    user: result.user,
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    expiresIn: result.expiresIn,
  });
}

// ============================================================
// LOGIN
// ============================================================
export async function login(req: Request, res: Response): Promise<void> {
  const { email, password } = req.body as {
    email: string;
    password: string;
  };

  const result = await authService.login({
    email,
    password,
    requestId: req.id,
    ip: req.ip ?? 'unknown',
    userAgent: req.header('user-agent') ?? 'unknown',
  });

  // Refresh token also as HttpOnly cookie for browser clients.
  res.cookie('upp_refresh', result.refreshToken, {
    httpOnly: true,
    secure: config.isProd,
    sameSite: 'lax',
    path: '/api/v1/auth',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  res.status(200).json({
    user: result.user,
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    expiresIn: result.expiresIn,
  });
}

// ============================================================
// REFRESH
// ============================================================
export async function refresh(req: Request, res: Response): Promise<void> {
  const { refreshToken } = req.body as { refreshToken: string };

  const result = await authService.refresh({
    refreshToken,
    requestId: req.id,
    ip: req.ip ?? 'unknown',
    userAgent: req.header('user-agent') ?? 'unknown',
  });

  res.cookie('upp_refresh', result.refreshToken, {
    httpOnly: true,
    secure: config.isProd,
    sameSite: 'lax',
    path: '/api/v1/auth',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  res.status(200).json({
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    expiresIn: result.expiresIn,
  });
}

// ============================================================
// LOGOUT (single session)
// ============================================================
export async function logout(req: Request, res: Response): Promise<void> {
  const { refreshToken } = req.body as { refreshToken: string };
  await authService.logout({ refreshToken, requestId: req.id });
  res.clearCookie('upp_refresh', { path: '/api/v1/auth' });
  res.status(204).send();
}

// ============================================================
// LOGOUT ALL
// ============================================================
export async function logoutAll(req: Request, res: Response): Promise<void> {
  const user = getCurrentUser(req);
  await authService.logoutAll({ userId: user.id, requestId: req.id });
  res.clearCookie('upp_refresh', { path: '/api/v1/auth' });
  res.status(204).send();
}

// ============================================================
// FORGOT PASSWORD
// ============================================================
export async function forgotPassword(
  req: Request,
  res: Response,
): Promise<void> {
  const { email } = req.body as { email: string };
  await authService.forgotPassword({ email, requestId: req.id });
  // Always 202 with generic message — no account enumeration.
  res.status(202).json({
    message: 'If an account with that email exists, a reset link has been sent.',
  });
}

// ============================================================
// RESET PASSWORD
// ============================================================
export async function resetPassword(
  req: Request,
  res: Response,
): Promise<void> {
  const { token, newPassword } = req.body as {
    token: string;
    newPassword: string;
  };
  await authService.resetPassword({
    token,
    newPassword,
    requestId: req.id,
  });
  res.status(200).json({ message: 'Password has been reset' });
}

// ============================================================
// EMAIL VERIFICATION
// ============================================================
export async function verifyEmail(
  req: Request,
  res: Response,
): Promise<void> {
  const { token } = req.body as { token: string };
  await authService.verifyEmail({ token, requestId: req.id });
  res.status(200).json({ message: 'Email verified successfully' });
}

// ============================================================
// RESEND VERIFICATION
// ============================================================
export async function resendVerification(
  req: Request,
  res: Response,
): Promise<void> {
  const user = getCurrentUser(req);
  await authService.resendVerification({
    userId: user.id,
    requestId: req.id,
  });
  res.status(202).json({
    message: 'Verification email has been sent',
  });
}