/**
 * Draft model (Mongoose).
 *
 * One document per draft. Contains the FULL current content, plus a
 * monotonically increasing `version` and metadata needed to rebuild
 * state from ops if necessary.
 *
 * Collections layout:
 *   drafts      — one doc per draft (this file)
 *   draft_ops   — append-only log of patches (DraftOp.model.ts)
 *
 * Indexes:
 *   - { ownerId: 1, updatedAt: -1 }        — "my drafts, recent first"
 *   - { ownerId: 1, status: 1, updatedAt: -1 } — "my drafts, filtered by status"
 *   - { status: 1, publishedAt: -1 }       — "recently published"
 *   - text index on title for search
 *
 * Notes:
 *   - `content` is stored as a string. For rich-text (ProseMirror, TipTap),
 *     store the JSON-encoded document as a string and parse on read.
 *     Storing as native nested objects in Mongo would make diffing harder.
 *   - `metadata` is a freeform object for taxonomy (tags, categories, cover).
 *   - `version` is incremented on every applied patch (see patch-handler).
 *   - `opCountSinceSnapshot` tracks when to trigger a full snapshot (the
 *     snapshot is just the current `content` field, which is already kept
 *     up to date on every patch — see patch-handler for the flow).
 */

import { Schema, model, type Document, type Types } from 'mongoose';

// ============================================================
// ENUMS
// ============================================================
export const DRAFT_STATUSES = ['draft', 'published', 'archived', 'deleted'] as const;
export type DraftStatus = (typeof DRAFT_STATUSES)[number];

export const CONTENT_TYPES = ['article', 'book', 'news_post'] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

// ============================================================
// DOCUMENT INTERFACE
// ============================================================
export interface DraftDoc extends Document {
  _id: Types.ObjectId;
  ownerId: Types.ObjectId;
  title: string;
  contentType: ContentType;
  language: string;
  content: string; // serialized editor document
  metadata: Record<string, unknown>;
  status: DraftStatus;
  version: number;
  opCountSinceSnapshot: number;
  wordCount: number;
  readTimeMinutes: number;
  publishedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================
// SCHEMA
// ============================================================
const DraftSchema = new Schema<DraftDoc>(
  {
    ownerId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    title: {
      type: String,
      trim: true,
      maxlength: 500,
      default: 'Untitled',
    },
    contentType: {
      type: String,
      enum: CONTENT_TYPES,
      default: 'article',
      required: true,
    },
    language: {
      type: String,
      default: 'en-US',
      match: /^[a-z]{2}-[A-Z]{2}$/,
    },
    content: {
      type: String,
      default: '',
      maxlength: 5_000_000, // matches config.editor.maxDraftChars
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
    status: {
      type: String,
      enum: DRAFT_STATUSES,
      default: 'draft',
      required: true,
    },
    version: {
      type: Number,
      default: 0,
      min: 0,
      required: true,
    },
    opCountSinceSnapshot: {
      type: Number,
      default: 0,
      min: 0,
      required: true,
    },
    wordCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    readTimeMinutes: {
      type: Number,
      default: 0,
      min: 0,
    },
    publishedAt: {
      type: Date,
      default: null,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: 'drafts',
    // Do not return Mongoose internals in `.lean()` responses
    versionKey: false,
  },
);

// ============================================================
// INDEXES
// ============================================================
// "My drafts, recent first" — most common listing query
DraftSchema.index({ ownerId: 1, updatedAt: -1 });

// "My drafts filtered by status"
DraftSchema.index({ ownerId: 1, status: 1, updatedAt: -1 });

// "Recently published" — public listing
DraftSchema.index({ status: 1, publishedAt: -1 }, { sparse: true });

// Soft-delete queries exclude deleted docs
DraftSchema.index({ deletedAt: 1 }, { sparse: true });

// Text search on title (public site search)
DraftSchema.index(
  { title: 'text' },
  { name: 'draft_title_text', weights: { title: 10 } },
);

// Compound index for "recently published by owner"
DraftSchema.index({ ownerId: 1, status: 1, publishedAt: -1 });

// ============================================================
// VIRTUALS (computed, not stored)
// ============================================================
DraftSchema.virtual('isPublished').get(function (this: DraftDoc) {
  return this.status === 'published' && this.deletedAt === null;
});

DraftSchema.virtual('isDeleted').get(function (this: DraftDoc) {
  return this.deletedAt !== null;
});

// ============================================================
// HOOKS
// ============================================================
/**
 * Auto-compute word count and read time on save/update.
 * Rate: 200 words/min (average reading speed for prose).
 * Read time is rounded UP to at least 1 minute if there is content.
 */
DraftSchema.pre('save', function (next) {
  const text = this.content ?? '';
  const words = text.trim().split(/\s+/).filter(Boolean);
  this.wordCount = words.length;
  this.readTimeMinutes =
    words.length === 0 ? 0 : Math.max(1, Math.ceil(words.length / 200));
  next();
});

// ============================================================
// MODEL
// ============================================================
export const DraftModel = model<DraftDoc>('Draft', DraftSchema);