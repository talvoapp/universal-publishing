/**
 * Version controller — thin HTTP layer for draft history.
 */

import type { Request, Response } from 'express';
import * as versionService from '@/services/version.service';
import { getCurrentUser } from '@/middleware/auth.middleware';

// ============================================================
// LIST
// ============================================================
export async function list(req: Request, res: Response): Promise<void> {
  const user = getCurrentUser(req);
  const { id } = req.params as { id: string };
  const result = await versionService.listVersions({
    draftId: id,
    userId: user.id,
    role: user.role,
    query: req.query,
  });
  res.status(200).json(result);
}

// ============================================================
// GET ONE
// ============================================================
export async function getOne(req: Request, res: Response): Promise<void> {
  const user = getCurrentUser(req);
  const { id, version } = req.params as { id: string; version: number };
  const entry = await versionService.getVersion({
    draftId: id,
    userId: user.id,
    role: user.role,
    version,
  });
  res.status(200).json(entry);
}

// ============================================================
// REVERT
// ============================================================
export async function revert(req: Request, res: Response): Promise<void> {
  const user = getCurrentUser(req);
  const { id } = req.params as { id: string };
  const { to_version } = req.body as { to_version: number };
  const result = await versionService.revertToVersion({
    draftId: id,
    userId: user.id,
    role: user.role,
    toVersion: to_version,
    requestId: req.id,
  });
  res.status(200).json(result);
}