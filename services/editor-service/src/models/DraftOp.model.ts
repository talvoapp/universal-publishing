/**
 * DraftOp model — append-only log of applied patches.
 *
 * Every `patch` message received over the WebSocket produces exactly
 * one row here. This log serves three purposes:
 *
 *   1. **Audit / forensics** — who changed what, when.
 *   2. **Crash recovery** — if a draft doc is ever corrupted, replay
 *      from the last snapshot + ops to rebuild state.
 *   3. **Collaborator replay** — a newly-joined collaborator can replay
 *      ops from a chosen version to catch up (instead of a full snapshot).
 *
 * Retention: rows are kept forever for published drafts, and pruned
 * (via TTL index) 30 days after soft-deletion for deleted drafts.
 *
 * Never updated, never deleted except by retention policy.
 */

import { Schema, model, type Document, type Types } from 'mongoose';

// ============================================================
// TYPES
// ============================================================
export interface DraftOp extends Document {
  _id: Types.ObjectId;
  draftId: Types.ObjectId;
  version: number;
  ops: unknown[]; // validated + applied by patch-handler before insert
  userId: Types.ObjectId;
  clientOpId: string;
  createdAt: Date;
}

// ============================================================
// SCHEMA
// ============================================================
const DraftOpSchema = new Schema<DraftOp>(
  {
    draftId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    version: {
      type: Number,
      required: true,
      min: 1,
    },
    ops: {
      type: [Schema.Types.Mixed],
      required: true,
      validate: {
        validator: (v: unknown[]) => Array.isArray(v) && v.length > 0,
        message: 'ops must be a non-empty array',
      },
    },
    userId: {
      type: Schema.Types.ObjectId,
      required: true,
    },
    clientOpId: {
      type: String,
      required: true,
      maxlength: 64,
    },
    createdAt: {
      type: Date,
      required: true,
      default: () => new Date(),
    },
  },
  {
    timestamps: false, // createdAt is explicit above
    collection: 'draft_ops',
    versionKey: false,
  },
);

// ============================================================
// INDEXES
// ============================================================
// Primary access pattern: "replay from version X" for a draft
DraftOpSchema.index({ draftId: 1, version: 1 }, { unique: true });

// "Show recent activity on a draft"
DraftOpSchema.index({ draftId: 1, createdAt: -1 });

// "Which drafts did this user edit recently?"
DraftOpSchema.index({ userId: 1, createdAt: -1 });

// ============================================================
// IMMUTABILITY GUARD
// ============================================================
/**
 * Prevent accidental mutation of an existing op. The op log is
 * append-only by design — corrections should be new ops, not edits.
 */
DraftOpSchema.pre('save', function (next) {
  if (!this.isNew) {
    return next(new Error('DraftOp is append-only; updates are forbidden'));
  }
  next();
});

// ============================================================
// MODEL
// ============================================================
export const DraftOpModel = model<DraftOp>('DraftOp', DraftOpSchema);