/**
 * Publish service — dedicated orchestrator for the "publish draft" flow.
 *
 * Why a separate service (vs. just a method on DraftService)?
 *   1. Publish has more validation than a metadata edit:
 *      - email verified
 *      - content word count ≥ 100
 *      - status transitions (draft → published; archived → published; etc.)
 *      - version bump on the draft
 *      - outbox event emission with FULL payload (feed service needs title,
 *        excerpt, cover image, tags, etc.)
 *   2. Publish is expensive and rate-limited — isolating it makes it easy
 *      to instrument, monitor, and rate-limit independently.
 *   3. Eventually publishing will trigger:
 *      - Marketplace item creation (async via outbox)
 *      - Feed pre-compute (async via outbox)
 *      - Notification fan-out (async via outbox)
 *      - AI-generated metadata suggestion (async, optional)
 *
 * Design:
 *   - Validates and transitions state in Mongo.
 *   - Emits `DraftPublished` with a rich payload so consumers don't need
 *     to fetch the draft from Mongo themselves (avoids N+1 across services).
 *   - Returns the updated draft for immediate response.
 *   - All error paths use AppError subclasses → RFC 7807.
 */

import { Types } from 'mongoose';
import { DraftModel, type DraftDoc } from '@/models/Draft.model';
import { emit } from '@/outbox/publisher';
import {
  NotFoundError,
  BadRequestError,
  ForbiddenError,
  ConflictError,
} from '@/utils/errors';
import { createLogger } from '@/utils/logger';
import { internalToPublic, type PublicDraft } from '@/services/draft.service';

const log = createLogger('publish.service');

// ============================================================
// TYPES
// ============================================================
export interface PublishInput {
  draftId: string;
  userId: string;
  role: string;
  emailVerified: boolean;
  requestId: string;
}

export interface PublishResult {
  draft: PublicDraft;
  publishedAt: string;
  feedEventId: string;
}

// ============================================================
// CONSTANTS
// ============================================================
const MIN_WORDS_TO_PUBLISH = 100;
const MAX_TAGS_IN_EVENT = 20;
const EXCERPT_LENGTH = 280;

// ============================================================
// PUBLIC
// ============================================================
export async function publishDraft(input: PublishInput): Promise<PublishResult> {
  const { draftId, userId, role, emailVerified, requestId } = input;

  // ----- 1. Load draft -----
  if (!Types.ObjectId.isValid(draftId)) {
    throw new NotFoundError('Draft not found');
  }
  const draft = await DraftModel.findOne({
    _id: new Types.ObjectId(draftId),
    deletedAt: null,
  });
  if (!draft) throw new NotFoundError('Draft not found');

  // ----- 2. Authorization -----
  const isOwner = draft.ownerId.toString() === userId;
  const isAdmin = role === 'admin';
  if (!isOwner && !isAdmin) {
    throw new ForbiddenError('You do not have access to this draft');
  }

  // ----- 3. Pre-conditions -----
  if (!emailVerified) {
    throw new ForbiddenError('Email verification required to publish');
  }

  if (draft.status === 'published') {
    throw new ConflictError('Draft is already published', 'ALREADY_PUBLISHED');
  }
  if (draft.status === 'deleted') {
    throw new ConflictError('Draft has been deleted', 'DRAFT_DELETED');
  }
  if (draft.status === 'archived') {
    // Allow re-publishing from archived state — a common pattern.
  }

  if (draft.wordCount < MIN_WORDS_TO_PUBLISH) {
    throw new BadRequestError(
      `Draft must have at least ${MIN_WORDS_TO_PUBLISH} words to publish (currently ${draft.wordCount})`,
      'CONTENT_TOO_SHORT',
    );
  }

  if (!draft.title || draft.title.trim() === '' || draft.title === 'Untitled') {
    throw new BadRequestError(
      'Draft needs a title before publishing',
      'TITLE_REQUIRED',
    );
  }

  // ----- 4. Transition state -----
  const publishedAt = new Date();
  const updated = await DraftModel.findOneAndUpdate(
    {
      _id: draft._id,
      // Guard against concurrent publishes: only transition if currently
      // in a pre-published state.
      status: { $in: ['draft', 'archived'] },
      deletedAt: null,
    },
    {
      $set: {
        status: 'published',
        publishedAt,
        updatedAt: publishedAt,
      },
      $inc: { version: 1 },
    },
    { new: true },
  );

  // If someone else published it between our read and our update, `updated`
  // is null — treat as a conflict.
  if (!updated) {
    throw new ConflictError('Draft state changed during publish', 'PUBLISH_CONFLICT');
  }

  // ----- 5. Emit outbox event (rich payload for downstream) -----
  const feedEventId = await emitPublishEvent(updated, requestId);

  log.info(
    {
      draftId: draftId,
      ownerId: userId,
      wordCount: updated.wordCount,
      feedEventId,
      requestId,
    },
    'Draft published',
  );

  return {
    draft: await internalToPublic(updated),
    publishedAt: publishedAt.toISOString(),
    feedEventId,
  };
}

// ============================================================
// EVENT EMISSION
// ============================================================
/**
 * Emits a `DraftPublished` event with everything downstream services need
 * so they don't need a follow-up fetch:
 *
 *   - feed-service         → needs title, excerpt, cover, author, tags
 *   - marketplace-service  → needs contentType, word count, price hints
 *   - notification-service → needs title, author, id
 *
 * The excerpt is computed once here (not per-consumer).
 */
async function emitPublishEvent(
  draft: DraftDoc,
  requestId: string,
): Promise<string> {
  const excerpt = buildExcerpt(draft.content);
  const tags = extractTags(draft.metadata);

  const payload = {
    draftId: draft._id.toString(),
    ownerId: draft.ownerId.toString(),
    title: draft.title,
    contentType: draft.contentType,
    language: draft.language,
    wordCount: draft.wordCount,
    readTimeMinutes: draft.readTimeMinutes,
    publishedAt: draft.publishedAt!.toISOString(),
    version: draft.version,
    excerpt,
    tags,
    coverImageUrl: extractCoverImage(draft.metadata),
    requestId,
  };

  await emit('DraftPublished', draft._id.toString(), payload);

  // Event ID is generated inside emit(); we return a stable placeholder
  // that downstream logs can correlate with. In practice consumers use
  // the event's own `id` field from the Kafka message header.
  return `${draft._id.toString()}:${draft.version}`;
}

// ============================================================
// HELPERS
// ============================================================
/**
 * Build a plaintext excerpt suitable for feed previews.
 * Strips common markup tokens if present (light normalization).
 */
function buildExcerpt(content: string): string {
  if (!content) return '';
  const plain = content
    .replace(/<[^>]*>/g, ' ') // strip HTML tags if any
    .replace(/[#*_~`]/g, '') // strip Markdown emphasis
    .replace(/\s+/g, ' ')
    .trim();
  if (plain.length <= EXCERPT_LENGTH) return plain;
  return plain.slice(0, EXCERPT_LENGTH).replace(/\s\S*$/, '') + '…';
}

function extractTags(metadata: Record<string, unknown>): string[] {
  const raw = metadata['tags'];
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((t): t is string => typeof t === 'string')
    .map((t) => t.toLowerCase())
    .slice(0, MAX_TAGS_IN_EVENT);
}

function extractCoverImage(metadata: Record<string, unknown>): string | null {
  const raw = metadata['coverImageUrl'];
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}