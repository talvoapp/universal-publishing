/**
 * Draft service — all business logic for draft lifecycle.
 *
 * Responsibilities:
 *   - Create drafts with initial state
 *   - List with cursor pagination
 *   - Enforce ownership/authorization
 *   - Optimistic concurrency (If-Match)
 *   - Publish (with content + email verification checks)
 *   - Emit outbox events
 *   - Manage tags (stored in metadata.tags)
 *
 * Authorization model:
 *   - Owner can do anything
 *   - Admin can do anything
 *   - Everyone else → 403
 *
 * Note: Content changes go through WebSocket (patch-handler), not here.
 */

import { Types } from 'mongoose';
import { DraftModel, type DraftDoc } from '@/models/Draft.model';
import { emit } from '@/outbox/publisher';
import { config } from '@/config';
import {
  NotFoundError,
  ForbiddenError,
  ConflictError,
  BadRequestError,
} from '@/utils/errors';
import { createLogger } from '@/utils/logger';
import type {
  CreateDraftInput,
  UpdateDraftInput,
  ListDraftsQuery,
} from '@/types/index';

const log = createLogger('draft.service');

// ============================================================
// TYPES
// ============================================================
export interface PublicDraft {
  id: string;
  ownerId: string;
  title: string;
  contentType: string;
  language: string;
  content: string;
  metadata: Record<string, unknown>;
  status: string;
  version: number;
  wordCount: number;
  readTimeMinutes: number;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ============================================================
// HELPERS
// ============================================================
function toPublicDraft(d: DraftDoc): PublicDraft {
  return {
    id: d._id.toString(),
    ownerId: d.ownerId.toString(),
    title: d.title,
    contentType: d.contentType,
    language: d.language,
    content: d.content,
    metadata: d.metadata,
    status: d.status,
    version: d.version,
    wordCount: d.wordCount,
    readTimeMinutes: d.readTimeMinutes,
    publishedAt: d.publishedAt?.toISOString() ?? null,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

function assertOwnerOrAdmin(
  draft: DraftDoc,
  userId: string,
  role: string,
): void {
  const isOwner = draft.ownerId.toString() === userId;
  const isAdmin = role === 'admin';
  if (!isOwner && !isAdmin) {
    throw new ForbiddenError('You do not have access to this draft');
  }
}

async function findDraftOrFail(draftId: string): Promise<DraftDoc> {
  const draft = await DraftModel.findOne({
    _id: new Types.ObjectId(draftId),
    deletedAt: null,
  });
  if (!draft) throw new NotFoundError('Draft not found');
  return draft;
}

// ============================================================
// CREATE
// ============================================================
export async function createDraft(input: {
  ownerId: string;
  input: CreateDraftInput;
  requestId: string;
}): Promise<PublicDraft> {
  const { ownerId, input: body } = input;

  const draft = await DraftModel.create({
    ownerId: new Types.ObjectId(ownerId),
    title: body.title?.trim() || 'Untitled',
    contentType: body.contentType,
    language: body.language ?? 'en-US',
    content: '',
    metadata: body.metadata ?? {},
    status: 'draft',
    version: 0,
    opCountSinceSnapshot: 0,
  });

  log.info(
    { draftId: draft._id.toString(), ownerId, requestId: input.requestId },
    'Draft created',
  );

  return toPublicDraft(draft);
}

// ============================================================
// LIST
// ============================================================
export async function listDrafts(input: {
  ownerId: string;
  query: ListDraftsQuery;
}): Promise<{ data: PublicDraft[]; next_cursor: string | null }> {
  const { ownerId, query } = input;
  const limit = query.limit;

  const filter: Record<string, unknown> = {
    ownerId: new Types.ObjectId(ownerId),
    deletedAt: null,
  };

  if (query.status !== 'all') {
    filter['status'] = query.status;
  }
  if (query.contentType) {
    filter['contentType'] = query.contentType;
  }

  // Cursor format: base64(updatedAtISO + "_" + id)
  // Ensures stable pagination even if items are edited concurrently.
  if (query.cursor) {
    const [updatedAtStr, id] = Buffer.from(query.cursor, 'base64').toString('utf8').split('_');
    if (updatedAtStr && id) {
      filter['$or'] = [
        { updatedAt: { $lt: new Date(updatedAtStr) } },
        { updatedAt: new Date(updatedAtStr), _id: { $lt: new Types.ObjectId(id) } },
      ];
    }
  }

  const docs = await DraftModel.find(filter)
    .sort({ updatedAt: -1, _id: -1 })
    .limit(limit + 1)
    .lean();

  const hasMore = docs.length > limit;
  const items = hasMore ? docs.slice(0, limit) : docs;

  let nextCursor: string | null = null;
  if (hasMore && items.length > 0) {
    const last = items[items.length - 1]!;
    nextCursor = Buffer.from(
      `${last.updatedAt.toISOString()}_${last._id.toString()}`,
    ).toString('base64');
  }

  return {
    data: items.map((d) => toPublicDraft(d as unknown as DraftDoc)),
    next_cursor: nextCursor,
  };
}

// ============================================================
// GET ONE
// ============================================================
export async function getDraft(input: {
  draftId: string;
  userId: string;
  role: string;
}): Promise<PublicDraft> {
  const draft = await findDraftOrFail(input.draftId);
  assertOwnerOrAdmin(draft, input.userId, input.role);
  return toPublicDraft(draft);
}

// ============================================================
// UPDATE (metadata only — content via WebSocket)
// ============================================================
export async function updateDraft(input: {
  draftId: string;
  userId: string;
  role: string;
  input: UpdateDraftInput;
  expectedVersion?: number;
  requestId: string;
}): Promise<PublicDraft> {
  const draft = await findDraftOrFail(input.draftId);
  assertOwnerOrAdmin(draft, input.userId, input.role);

  // Optimistic concurrency if If-Match header provided
  if (
    input.expectedVersion !== undefined &&
    input.expectedVersion !== draft.version
  ) {
    throw new ConflictError(
      `Version mismatch: expected ${input.expectedVersion}, got ${draft.version}`,
      'VERSION_MISMATCH',
    );
  }

  const update: Record<string, unknown> = {};
  if (input.input.title !== undefined) update['title'] = input.input.title;
  if (input.input.language !== undefined) update['language'] = input.input.language;
  if (input.input.metadata !== undefined) update['metadata'] = input.input.metadata;

  if (Object.keys(update).length === 0) {
    return toPublicDraft(draft);
  }

  const updated = await DraftModel.findByIdAndUpdate(
    draft._id,
    { $set: { ...update, updatedAt: new Date() } },
    { new: true },
  );
  if (!updated) throw new NotFoundError('Draft not found after update');

  return toPublicDraft(updated);
}

// ============================================================
// DELETE (soft)
// ============================================================
export async function deleteDraft(input: {
  draftId: string;
  userId: string;
  role: string;
  requestId: string;
}): Promise<void> {
  const draft = await findDraftOrFail(input.draftId);
  assertOwnerOrAdmin(draft, input.userId, input.role);

  await DraftModel.updateOne(
    { _id: draft._id },
    { $set: { deletedAt: new Date(), status: 'deleted' } },
  );

  await emit('DraftDeleted', draft._id.toString(), {
    draftId: draft._id.toString(),
    ownerId: draft.ownerId.toString(),
    requestId: input.requestId,
  });

  log.info({ draftId: draft._id.toString(), requestId: input.requestId }, 'Draft soft-deleted');
}

// ============================================================
// PUBLISH
// ============================================================
export async function publishDraft(input: {
  draftId: string;
  userId: string;
  role: string;
  emailVerified: boolean;
  requestId: string;
}): Promise<PublicDraft> {
  const draft = await findDraftOrFail(input.draftId);
  assertOwnerOrAdmin(draft, input.userId, input.role);

  if (!input.emailVerified) {
    throw new ForbiddenError('Email verification required to publish');
  }

  if (draft.status === 'published') {
    throw new ConflictError('Draft is already published', 'ALREADY_PUBLISHED');
  }

  // Minimum content requirement — 100 words
  if (draft.wordCount < 100) {
    throw new BadRequestError(
      `Draft must have at least 100 words before publishing (currently ${draft.wordCount})`,
      'CONTENT_TOO_SHORT',
    );
  }

  const now = new Date();
  const updated = await DraftModel.findByIdAndUpdate(
    draft._id,
    {
      $set: {
        status: 'published',
        publishedAt: now,
        updatedAt: now,
      },
    },
    { new: true },
  );
  if (!updated) throw new NotFoundError('Draft not found after publish');

  await emit('DraftPublished', draft._id.toString(), {
    draftId: draft._id.toString(),
    ownerId: draft.ownerId.toString(),
    title: draft.title,
    contentType: draft.contentType,
    wordCount: draft.wordCount,
    publishedAt: now.toISOString(),
    requestId: input.requestId,
  });

  log.info(
    { draftId: draft._id.toString(), requestId: input.requestId },
    'Draft published',
  );

  return toPublicDraft(updated);
}

// ============================================================
// FORCE SNAPSHOT
// ============================================================
export async function forceSnapshot(input: {
  draftId: string;
  userId: string;
  role: string;
}): Promise<{ version: number; snapshot_at: string }> {
  const draft = await findDraftOrFail(input.draftId);
  assertOwnerOrAdmin(draft, input.userId, input.role);

  const now = new Date();
  await DraftModel.updateOne(
    { _id: draft._id },
    { $set: { opCountSinceSnapshot: 0, updatedAt: now } },
  );

  await emit('DraftSnapshotCreated', draft._id.toString(), {
    draftId: draft._id.toString(),
    version: draft.version,
    snapshotAt: now.toISOString(),
  });

  return {
    version: draft.version,
    snapshot_at: now.toISOString(),
  };
}

// ============================================================
// TAGS (stored in metadata.tags)
// ============================================================
export async function addTags(input: {
  draftId: string;
  userId: string;
  role: string;
  tags: string[];
}): Promise<PublicDraft> {
  const draft = await findDraftOrFail(input.draftId);
  assertOwnerOrAdmin(draft, input.userId, input.role);

  const existing: string[] = Array.isArray(draft.metadata?.['tags'])
    ? (draft.metadata['tags'] as string[])
    : [];
  const merged = Array.from(new Set([...existing, ...input.tags])).slice(0, 20);

  const updated = await DraftModel.findByIdAndUpdate(
    draft._id,
    {
      $set: {
        'metadata.tags': merged,
        updatedAt: new Date(),
      },
    },
    { new: true },
  );
  if (!updated) throw new NotFoundError('Draft not found after tag update');
  return toPublicDraft(updated);
}

export async function removeTag(input: {
  draftId: string;
  userId: string;
  role: string;
  tag: string;
}): Promise<PublicDraft> {
  const draft = await findDraftOrFail(input.draftId);
  assertOwnerOrAdmin(draft, input.userId, input.role);

  const existing: string[] = Array.isArray(draft.metadata?.['tags'])
    ? (draft.metadata['tags'] as string[])
    : [];
  const filtered = existing.filter((t) => t !== input.tag);

  const updated = await DraftModel.findByIdAndUpdate(
    draft._id,
    {
      $set: {
        'metadata.tags': filtered,
        updatedAt: new Date(),
      },
    },
    { new: true },
  );
  if (!updated) throw new NotFoundError('Draft not found after tag update');
  return toPublicDraft(updated);
}

// ============================================================
// INTERNAL HELPERS (for version service)
// ============================================================
export async function loadDraftForWrite(input: {
  draftId: string;
  userId: string;
  role: string;
}): Promise<DraftDoc> {
  const draft = await findDraftOrFail(input.draftId);
  assertOwnerOrAdmin(draft, input.userId, input.role);
  return draft;
}

export async function internalFindDraft(draftId: string): Promise<DraftDoc> {
  return findDraftOrFail(draftId);
}

export async function internalToPublic(d: DraftDoc): Promise<PublicDraft> {
  return toPublicDraft(d);
}

// Re-export config for controllers that need limits
export { config };