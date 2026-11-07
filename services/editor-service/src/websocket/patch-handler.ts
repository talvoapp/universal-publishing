/**
 * Patch handler — applies incremental edits to a draft.
 *
 * Flow per `patch` frame:
 *   1. Enforce draft size limit BEFORE applying.
 *   2. Check `baseVersion === draft.version` (optimistic concurrency).
 *      If not, send `nack` with `serverVersion` so client can rebase.
 *   3. Apply ops to the draft content in-memory.
 *   4. Persist: insert ops into `draft_ops`, increment version,
 *      update draft snapshot — atomically via a MongoDB transaction.
 *   5. Coalesce: if the last write for this draft was <coalesceMs ago
 *      AND from the same session, we may merge adjacent ops in a
 *      subsequent batch (currently we persist each batch immediately —
 *      coalescing is a future optimization that requires careful ordering).
 *   6. Take a snapshot every N ops (config.editor.snapshotEveryNOps).
 *   7. Broadcast the applied patch to all other sessions in the draft.
 *   8. Send `ack` to the originator.
 *
 * Op format (ProseMirror-like, but framework-agnostic):
 *   { type: 'insert', pos: number, text: string }
 *   { type: 'delete', pos: number, text: string }
 *   { type: 'replace', pos: number, from: string, to: string }
 *   { type: 'attr',   path: string, value: unknown }   // metadata changes
 *
 * The server treats ops as opaque as long as they satisfy the shape
 * above. Full ProseMirror op validation happens client-side.
 */

import { Types } from 'mongoose';
import { DraftModel } from '@/models/Draft.model';
import { DraftOpModel } from '@/models/DraftOp.model';
import { withMongoTransaction } from '@/db/mongo';
import { config } from '@/config';
import { createLogger } from '@/utils/logger';
import { sendError, sendJson, getSessionsForDraft } from './handler';
import { bumpVersion, type Session } from './session';

const log = createLogger('websocket.patch');

// ============================================================
// TYPES
// ============================================================
interface InsertOp {
  type: 'insert';
  pos: number;
  text: string;
}
interface DeleteOp {
  type: 'delete';
  pos: number;
  text: string;
}
interface ReplaceOp {
  type: 'replace';
  pos: number;
  from: string;
  to: string;
}
interface AttrOp {
  type: 'attr';
  path: string;
  value: unknown;
}
type Op = InsertOp | DeleteOp | ReplaceOp | AttrOp;

export interface PatchInput {
  baseVersion: number;
  ops: unknown[]; // validated below
  clientOpId: string;
}

// ============================================================
// OP VALIDATION
// ============================================================
function validateOp(raw: unknown): Op {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Op must be an object');
  }
  const o = raw as Record<string, unknown>;
  const t = o['type'];

  if (t === 'insert' || t === 'delete') {
    if (typeof o['pos'] !== 'number' || o['pos'] < 0) {
      throw new Error(`${t}.pos must be a non-negative number`);
    }
    if (typeof o['text'] !== 'string') {
      throw new Error(`${t}.text must be a string`);
    }
    return { type: t, pos: o['pos'], text: o['text'] } as Op;
  }

  if (t === 'replace') {
    if (typeof o['pos'] !== 'number' || o['pos'] < 0) {
      throw new Error('replace.pos must be a non-negative number');
    }
    if (typeof o['from'] !== 'string' || typeof o['to'] !== 'string') {
      throw new Error('replace.from and replace.to must be strings');
    }
    return { type: 'replace', pos: o['pos'], from: o['from'], to: o['to'] };
  }

  if (t === 'attr') {
    if (typeof o['path'] !== 'string') {
      throw new Error('attr.path must be a string');
    }
    return { type: 'attr', path: o['path'], value: o['value'] };
  }

  throw new Error(`Unknown op type: ${String(t)}`);
}

// ============================================================
// OP APPLICATION (in-memory)
// ============================================================
/**
 * Applies a list of ops to a text document. Metadata (`attr` ops) are
 * applied to the draft's `metadata` field, not the text.
 *
 * Returns `{ newText, attrChanges }`.
 */
function applyOps(
  currentText: string,
  currentMetadata: Record<string, unknown>,
  ops: Op[],
): { newText: string; newMetadata: Record<string, unknown> } {
  let text = currentText;
  const metadata = { ...currentMetadata };

  for (const op of ops) {
    if (op.type === 'insert') {
      if (op.pos > text.length) throw new Error('insert.pos out of range');
      text = text.slice(0, op.pos) + op.text + text.slice(op.pos);
    } else if (op.type === 'delete') {
      if (op.pos + op.text.length > text.length) {
        throw new Error('delete range out of bounds');
      }
      const removed = text.slice(op.pos, op.pos + op.text.length);
      // Sanity: the deleted text should match what the client says
      if (removed !== op.text) {
        throw new Error('delete.text does not match current content');
      }
      text = text.slice(0, op.pos) + text.slice(op.pos + op.text.length);
    } else if (op.type === 'replace') {
      if (op.pos + op.from.length > text.length) {
        throw new Error('replace range out of bounds');
      }
      const slice = text.slice(op.pos, op.pos + op.from.length);
      if (slice !== op.from) {
        throw new Error('replace.from does not match current content');
      }
      text = text.slice(0, op.pos) + op.to + text.slice(op.pos + op.from.length);
    } else if (op.type === 'attr') {
      setNested(metadata, op.path, op.value);
    }
  }

  return { newText: text, newMetadata: metadata };
}

function setNested(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.').filter(Boolean);
  if (parts.length === 0) throw new Error('Empty attr path');
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i]!;
    const next = cur[k];
    if (typeof next !== 'object' || next === null) {
      cur[k] = {};
    }
    cur = cur[k] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]!] = value;
}

// ============================================================
// MAIN HANDLER
// ============================================================
export async function handlePatch(
  session: Session,
  input: PatchInput,
): Promise<void> {
  const { draftId, userId } = session;
  if (!draftId || !userId) {
    sendError(session, 'not_subscribed', 'Not subscribed to a draft');
    return;
  }

  // ----- Validate ops -----
  let ops: Op[];
  try {
    ops = input.ops.map(validateOp);
  } catch (err) {
    sendJson(session, {
      type: 'nack',
      clientOpId: input.clientOpId,
      reason: 'invalid_op',
      detail: err instanceof Error ? err.message : 'Invalid op',
    });
    return;
  }

  // ----- Load current draft (short transaction) -----
  const draft = await DraftModel.findById(draftId).lean();
  if (!draft) {
    sendError(session, 'draft_not_found', 'Draft no longer exists');
    return;
  }

  // ----- Optimistic concurrency check -----
  if (draft.version !== input.baseVersion) {
    sendJson(session, {
      type: 'nack',
      clientOpId: input.clientOpId,
      reason: 'version_mismatch',
      serverVersion: draft.version,
    });
    return;
  }

  // ----- Apply ops in memory -----
  const currentText = typeof draft.content === 'string' ? draft.content : '';
  let newText: string;
  let newMetadata: Record<string, unknown>;
  try {
    const result = applyOps(currentText, draft.metadata, ops);
    newText = result.newText;
    newMetadata = result.newMetadata;
  } catch (err) {
    sendJson(session, {
      type: 'nack',
      clientOpId: input.clientOpId,
      reason: 'apply_failed',
      detail: err instanceof Error ? err.message : 'Op application failed',
    });
    return;
  }

  // ----- Enforce size limit -----
  if (newText.length > config.editor.maxDraftChars) {
    sendError(
      session,
      'draft_too_large',
      `Draft exceeds maximum size of ${config.editor.maxDraftChars} characters`,
    );
    return;
  }

  // ----- Persist (transaction) -----
  const newVersion = draft.version + 1;
  const opCount = draft.opCountSinceSnapshot + 1;
  const shouldSnapshot = opCount >= config.editor.snapshotEveryNOps;

  try {
    await withMongoTransaction(async (mongoSession) => {
      // Append ops to the log
      await DraftOpModel.create(
        [
          {
            draftId: new Types.ObjectId(draftId),
            version: newVersion,
            ops,
            userId: new Types.ObjectId(userId),
            clientOpId: input.clientOpId,
            createdAt: new Date(),
          },
        ],
        { session: mongoSession },
      );

      // Update the draft
      const update: Record<string, unknown> = {
        $set: {
          content: newText,
          metadata: newMetadata,
          version: newVersion,
          updatedAt: new Date(),
          opCountSinceSnapshot: shouldSnapshot ? 0 : opCount,
        },
        ...(shouldSnapshot
          ? { $set: { ...(update as { $set: Record<string, unknown> })['$set'], snapshotAt: new Date() } }
          : {}),
      };

      await DraftModel.updateOne(
        { _id: new Types.ObjectId(draftId), version: draft.version },
        update,
        { session: mongoSession },
      );
    });
  } catch (err) {
    log.error({ err, draftId, clientOpId: input.clientOpId }, 'Patch persist failed');
    sendJson(session, {
      type: 'nack',
      clientOpId: input.clientOpId,
      reason: 'persist_failed',
      detail: 'Could not persist patch',
    });
    return;
  }

  // ----- Update session's known version -----
  bumpVersion(session, newVersion);

  // ----- Ack originator -----
  sendJson(session, {
    type: 'ack',
    clientOpId: input.clientOpId,
    version: newVersion,
    serverTime: Date.now(),
  });

  // ----- Broadcast to other sessions -----
  const allSessions = getSessionsForDraft(draftId);
  for (const s of allSessions) {
    if (s.connectionId === session.connectionId) continue;
    sendJson(s, {
      type: 'patch',
      baseVersion: input.baseVersion,
      ops,
      clientOpId: input.clientOpId,
      userId,
      version: newVersion,
    });
  }
}