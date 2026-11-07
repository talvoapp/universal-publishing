/**
 * Draft controller — thin HTTP layer.
 *
 * Each handler:
 *   1. Extracts data from req (already validated by middleware)
 *   2. Calls exactly one service method
 *   3. Returns consistent JSON
 *
 * No business logic here. Authorization + persistence live in the service.
 */

import type { Request, Response } from 'express';
import * as draftService from '@/services/draft.service';
import { getCurrentUser } from '@/middleware/auth.middleware';

// ============================================================
// CREATE
// ============================================================
export async function create(req: Request, res: Response): Promise<void> {
  const user = getCurrentUser(req);
  const draft = await draftService.createDraft({
    ownerId: user.id,
    input: req.body,
    requestId: req.id,
  });
  res.status(201).json({ draft });
}

// ============================================================
// LIST
// ============================================================
export async function list(req: Request, res: Response): Promise<void> {
  const user = getCurrentUser(req);
  const result = await draftService.listDrafts({
    ownerId: user.id,
    query: req.query,
  });
  res.status(200).json(result);
}

// ============================================================
// GET ONE
// ============================================================
export async function getOne(req: Request, res: Response): Promise<void> {
  const user = getCurrentUser(req);
  const { id } = req.params as { id: string };
  const draft = await draftService.getDraft({
    draftId: id,
    userId: user.id,
    role: user.role,
  });
  res.status(200).json({ draft });
}

// ============================================================
// UPDATE
// ============================================================
export async function update(req: Request, res: Response): Promise<void> {
  const user = getCurrentUser(req);
  const { id } = req.params as { id: string };
  const ifMatch = req.header('if-match');
  const expectedVersion = ifMatch ? parseInt(ifMatch.replace(/"/g, ''), 10) : undefined;

  const draft = await draftService.updateDraft({
    draftId: id,
    userId: user.id,
    role: user.role,
    input: req.body,
    expectedVersion: Number.isFinite(expectedVersion) ? expectedVersion : undefined,
    requestId: req.id,
  });
  res.status(200).json({ draft });
}

// ============================================================
// DELETE
// ============================================================
export async function remove(req: Request, res: Response): Promise<void> {
  const user = getCurrentUser(req);
  const { id } = req.params as { id: string };
  await draftService.deleteDraft({
    draftId: id,
    userId: user.id,
    role: user.role,
    requestId: req.id,
  });
  res.status(204).send();
}

// ============================================================
// PUBLISH
// ============================================================
export async function publish(req: Request, res: Response): Promise<void> {
  const user = getCurrentUser(req);
  const { id } = req.params as { id: string };
  const draft = await draftService.publishDraft({
    draftId: id,
    userId: user.id,
    role: user.role,
    emailVerified: user.emailVerified,
    requestId: req.id,
  });
  res.status(200).json({ draft });
}

// ============================================================
// SNAPSHOT
// ============================================================
export async function snapshot(req: Request, res: Response): Promise<void> {
  const user = getCurrentUser(req);
  const { id } = req.params as { id: string };
  const result = await draftService.forceSnapshot({
    draftId: id,
    userId: user.id,
    role: user.role,
  });
  res.status(200).json(result);
}

// ============================================================
// TAGS
// ============================================================
export async function addTags(req: Request, res: Response): Promise<void> {
  const user = getCurrentUser(req);
  const { id } = req.params as { id: string };
  const { tags } = req.body as { tags: string[] };
  const draft = await draftService.addTags({
    draftId: id,
    userId: user.id,
    role: user.role,
    tags,
  });
  res.status(200).json({ draft });
}

export async function removeTag(req: Request, res: Response): Promise<void> {
  const user = getCurrentUser(req);
  const { id, tag } = req.params as { id: string; tag: string };
  const draft = await draftService.removeTag({
    draftId: id,
    userId: user.id,
    role: user.role,
    tag,
  });
  res.status(200).json({ draft });
}