/**
 * Version service — draft history and revert.
 *
 * A "version" in this context is the sequence number of an applied patch
 * (every patch produces one `draft_ops` row with a unique version).
 *
 * However, listing ALL versions can be expensive for long-lived drafts.
 * Instead, we treat a "version" query as:
 *   - Fetch op rows for the draft, ordered by version
 *   - Return metadata (version, author, timestamp, op count) — NOT the
 *     full content, which would be huge
 *   - If the caller requests a specific version, we RECONSTRUCT the content
 *     by replaying ops from the last snapshot (or from version 0 if no
 *     snapshot exists) up to the requested version.
 *
 * Revert is append-only: it creates a NEW op that sets content to the
 * target version's content. The old ops remain in history.
 */

import { Types } from 'mongoose';
import { DraftModel, type DraftDoc } from '@/models/Draft.model';
import { DraftOpModel, type DraftOp } from '@/models/DraftOp.model';
import { emit } from '@/outbox/publisher';
import { NotFoundError, BadRequestError, ConflictError } from '@/utils/errors';
import { createLogger } from '@/utils/logger';
import {
  loadDraftForWrite,
  internalFindDraft,
  internalToPublic,
  type PublicDraft,
} from '@/services/draft.service';
import { config } from '@/config';

const log = createLogger('version.service');

// ============================================================
// TYPES
// ============================================================
export interface VersionListEntry {
  version: number;
  userId: string;
  opCount: number;
  createdAt: string;
}

export interface VersionDetail {
  version: number;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  createdBy: string;
}

// ============================================================
// LIST
// ============================================================
export async function listVersions(input: {
  draftId: string;
  userId: string;
  role: string;
  query: { cursor?: string; limit: number };
}): Promise<{ data: VersionListEntry[]; next_cursor: string | null }> {
  const draft = await loadDraftForWrite({
    draftId: input.draftId,
    userId: input.userId,
    role: input.role,
  });

  const limit = input.query.limit;
  const filter: Record<string, unknown> = {
    draftId: draft._id,
  };

  // Cursor is just the version number (descending)
  if (input.query.cursor) {
    const cursorVersion = parseInt(
      Buffer.from(input.query.cursor, 'base64').toString('utf8'),
      10,
    );
    if (Number.isFinite(cursorVersion)) {
      filter['version'] = { $lt: cursorVersion };
    }
  }

  const ops = await DraftOpModel.find(filter)
    .sort({ version: -1 })
    .limit(limit + 1)
    .lean();

  const hasMore = ops.length > limit;
  const items = hasMore ? ops.slice(0, limit) : ops;

  let nextCursor: string | null = null;
  if (hasMore && items.length > 0) {
    const last = items[items.length - 1]!;
    nextCursor = Buffer.from(String(last.version)).toString('base64');
  }

  return {
    data: items.map((op) => ({
      version: op.version,
      userId: op.userId.toString(),
      opCount: Array.isArray(op.ops) ? op.ops.length : 0,
      createdAt: op.createdAt.toISOString(),
    })),
    next_cursor: nextCursor,
  };
}

// ============================================================
// GET SPECIFIC VERSION (with content reconstruction)
// ============================================================
export async function getVersion(input: {
  draftId: string;
  userId: string;
  role: string;
  version: number;
}): Promise<VersionDetail> {
  const draft = await loadDraftForWrite({
    draftId: input.draftId,
    userId: input.userId,
    role: input.role,
  });

  if (input.version > draft.version) {
    throw new NotFoundError(`Version ${input.version} does not exist yet`);
  }

  // Strategy: reconstruct content by replaying ops from 0.
  // For drafts with a snapshot, we'd start from the snapshot's content
  // (which equals the current content at the time of the snapshot).
  //
  // Since we don't store per-snapshot content separately in v1, we
  // reconstruct by replaying ALL ops up to `version`. For long drafts
  // this can be slow, but it's bounded by config.editor.snapshotEveryNOps
  // (we could add a `snapshots` collection later).
  //
  // Optimization: if `version === draft.version`, return the current
  // content directly (no replay needed).

  if (input.version === draft.version) {
    const lastOp = await DraftOpModel.findOne({
      draftId: draft._id,
      version: input.version,
    })
      .select('userId createdAt')
      .lean();

    return {
      version: input.version,
      content: draft.content,
      metadata: draft.metadata,
      createdAt: (lastOp?.createdAt ?? draft.updatedAt).toISOString(),
      createdBy: lastOp?.userId.toString() ?? draft.ownerId.toString(),
    };
  }

  // Reconstruct: replay ops from version 1 up to target
  const allOps = await DraftOpModel.find({
    draftId: draft._id,
    version: { $lte: input.version },
  })
    .sort({ version: 1 })
    .lean();

  if (allOps.length === 0 && input.version > 0) {
    throw new NotFoundError(`No ops found for version ${input.version}`);
  }

  let content = '';
  let metadata: Record<string, unknown> = {};

  for (const op of allOps) {
    const applied = replayOps(content, metadata, op.ops as Op[]);
    content = applied.content;
    metadata = applied.metadata;
  }

  const lastOp = allOps[allOps.length - 1]!;

  return {
    version: input.version,
    content,
    metadata,
    createdAt: lastOp.createdAt.toISOString(),
    createdBy: lastOp.userId.toString(),
  };
}

// ============================================================
// REVERT — creates a NEW op that resets content (append-only)
// ============================================================
export async function revertToVersion(input: {
  draftId: string;
  userId: string;
  role: string;
  toVersion: number;
  requestId: string;
}): Promise<{ draft: PublicDraft; new_version: number }> {
  const draft = await loadDraftForWrite({
    draftId: input.draftId,
    userId: input.userId,
    role: input.role,
  });

  if (input.toVersion > draft.version) {
    throw new BadRequestError(
      `Cannot revert to a future version (${input.toVersion} > ${draft.version})`,
      'FUTURE_VERSION',
    );
  }

  if (input.toVersion === draft.version) {
    throw new ConflictError('Already at that version', 'SAME_VERSION');
  }

  // Reconstruct the target content
  const target = await getVersion({
    draftId: input.draftId,
    userId: input.userId,
    role: input.role,
    version: input.toVersion,
  });

  // Create a NEW op that sets the full content
  const newVersion = draft.version + 1;
  const now = new Date();

  await DraftOpModel.create({
    draftId: draft._id,
    version: newVersion,
    ops: [
      {
        type: 'attr',
        path: '__revert',
        value: {
          to_version: input.toVersion,
          reverted_at: now.toISOString(),
        },
      },
    ],
    userId: new Types.ObjectId(input.userId),
    clientOpId: `revert-${Date.now()}`,
    createdAt: now,
  });

  const updated = await DraftModel.findByIdAndUpdate(
    draft._id,
    {
      $set: {
        content: target.content,
        metadata: target.metadata,
        version: newVersion,
        opCountSinceSnapshot: draft.opCountSinceSnapshot + 1,
        updatedAt: now,
      },
    },
    { new: true },
  );

  if (!updated) throw new NotFoundError('Draft not found after revert');

  // Recompute word count
  updated.wordCount = countWords(updated.content);
  updated.readTimeMinutes = updated.wordCount === 0 ? 0 : Math.max(1, Math.ceil(updated.wordCount / 200));
  await updated.save();

  await emit('DraftReverted', draft._id.toString(), {
    draftId: draft._id.toString(),
    fromVersion: draft.version,
    toVersion: input.toVersion,
    newVersion,
    revertedBy: input.userId,
    requestId: input.requestId,
  });

  log.info(
    {
      draftId: draft._id.toString(),
      fromVersion: draft.version,
      toVersion: input.toVersion,
      newVersion,
      requestId: input.requestId,
    },
    'Draft reverted',
  );

  return {
    draft: await internalToPublic(updated),
    new_version: newVersion,
  };
}

// ============================================================
// OP REPLAY HELPERS
// (duplicated from patch-handler to avoid circular dependency)
// ============================================================
type Op =
  | { type: 'insert'; pos: number; text: string }
  | { type: 'delete'; pos: number; text: string }
  | { type: 'replace'; pos: number; from: string; to: string }
  | { type: 'attr'; path: string; value: unknown };

function replayOps(
  currentContent: string,
  currentMetadata: Record<string, unknown>,
  ops: Op[],
): { content: string; metadata: Record<string, unknown> } {
  let content = currentContent;
  const metadata = { ...currentMetadata };

  for (const op of ops) {
    try {
      if (op.type === 'insert') {
        content = content.slice(0, op.pos) + op.text + content.slice(op.pos);
      } else if (op.type === 'delete') {
        content = content.slice(0, op.pos) + content.slice(op.pos + op.text.length);
      } else if (op.type === 'replace') {
        content = content.slice(0, op.pos) + op.to + content.slice(op.pos + op.from.length);
      } else if (op.type === 'attr') {
        if (op.path !== '__revert') {
          setNested(metadata, op.path, op.value);
        }
      }
    } catch {
      // Skip malformed op during replay — best effort
    }
  }

  return { content, metadata };
}

function setNested(
  obj: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  const parts = path.split('.').filter(Boolean);
  if (parts.length === 0) return;
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i]!;
    const next = cur[k];
    if (typeof next !== 'object' || next === null) cur[k] = {};
    cur = cur[k] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]!] = value;
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}