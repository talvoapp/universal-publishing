/**
 * Taxonomy model — categories and tags.
 *
 * Design note:
 *   - v1 uses a STATIC category tree (in `services/taxonomy.service.ts`).
 *   - This model exists to support two future needs:
 *       1. Admin-editable categories (migration path from static → dynamic).
 *       2. A `tags` aggregate collection for fast autocomplete without
 *          scanning `drafts` (currently done via aggregation over `drafts`).
 *
 * The model is created now so:
 *   - The schema is version-controlled.
 *   - Indexes exist before we need them (build migrations are expensive).
 *   - The service can opt-in to DB-backed categories via a feature flag
 *     without schema changes.
 *
 * For v1, `taxonomy.service.ts` reads from the static tree; this model is
 * populated by a scheduled job (or manual seeding) once we enable dynamic
 * categories.
 */

import { Schema, model, type Document, type Types } from 'mongoose';

// ============================================================
// CATEGORY
// ============================================================
export interface CategoryDoc extends Document {
  _id: Types.ObjectId;
  slug: string;
  name: string;
  parentSlug: string | null;
  depth: number;
  isActive: boolean;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

const CategorySchema = new Schema<CategoryDoc>(
  {
    slug: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      match: /^[a-z0-9][a-z0-9.-]*$/,
      maxlength: 80,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    parentSlug: {
      type: String,
      default: null,
      trim: true,
      lowercase: true,
    },
    depth: {
      type: Number,
      required: true,
      min: 0,
      max: 3,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    order: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
    collection: 'categories',
    versionKey: false,
  },
);

// Common access patterns:
CategorySchema.index({ parentSlug: 1, order: 1 });
CategorySchema.index({ isActive: 1, order: 1 });

export const CategoryModel = model<CategoryDoc>('Category', CategorySchema);

// ============================================================
// TAG (aggregate)
// ============================================================
/**
 * A precomputed aggregate of tags across published drafts.
 * Kept in sync via the `DraftPublished` / `DraftDeleted` outbox events
 * (see outbox consumers in feed-service or a scheduled job in v1).
 *
 * Why an aggregate instead of querying `drafts` directly?
 *   - Autocomplete needs to be O(log n) fast — aggregation over drafts
 *     with millions of documents is slow.
 *   - Enables trending tags / counts without scanning.
 */
export interface TagDoc extends Document {
  _id: Types.ObjectId;
  tag: string;
  count: number;
  lastUsedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const TagSchema = new Schema<TagDoc>(
  {
    tag: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      match: /^[a-z0-9][a-z0-9-]*$/,
      maxlength: 40,
    },
    count: {
      type: Number,
      default: 0,
      min: 0,
    },
    lastUsedAt: {
      type: Date,
      default: () => new Date(),
    },
  },
  {
    timestamps: true,
    collection: 'tags',
    versionKey: false,
  },
);

// Text search for autocomplete; sort by count for "popular tags"
TagSchema.index({ tag: 'text' });
TagSchema.index({ count: -1, lastUsedAt: -1 });
TagSchema.index({ lastUsedAt: -1 });

export const TagModel = model<TagDoc>('Tag', TagSchema);