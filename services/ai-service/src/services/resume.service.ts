/**
 * Resume service — decides what to do when a client reconnects with
 * an existing sessionId.
 *
 * Outcomes:
 *   - NONE          → start a fresh session (no sessionId provided or
 *                     session not found)
 *   - REPLAY_DONE   → session already completed: replay the accumulated
 *                     text as a single `chunk`, then `done`. Idempotent.
 *   - RESUME_ACTIVE → session still streaming in another request:
 *                     reject with 409 (only one active stream per session).
 *   - CONTINUE      → session exists but was aborted: replay saved prefix
 *                     from index 0, then continue the provider stream.
 *                     (v1 does NOT truly resume the provider; it starts a
 *                     new provider call but skips the prefix the client
 *                     already has. This is best-effort and keeps UX smooth.)
 *
 * The `resume.service` doesn't touch the network. It only reads session
 * state and returns a decision object to the stream handler.
 */

import * as sessionStore from '@/sse/session-store';
import type { SSESession } from '@/sse/session-store';
import { createLogger } from '@/utils/logger';

const log = createLogger('resume.service');

// ============================================================
// TYPES
// ============================================================
export type ResumeDecision =
  | { kind: 'NONE' }
  | { kind: 'REPLAY_DONE'; session: SSESession }
  | { kind: 'REJECT_CONFLICT'; session: SSESession }
  | { kind: 'CONTINUE'; session: SSESession };

// ============================================================
// DECIDE
// ============================================================
export async function decide(input: {
  sessionId: string | undefined;
  userId: string;
}): Promise<ResumeDecision> {
  if (!input.sessionId) return { kind: 'NONE' };

  const existing = await sessionStore.getSession(input.sessionId);
  if (!existing) return { kind: 'NONE' };

  // Ownership check — a user can never resume another user's session.
  if (existing.userId !== input.userId) {
    log.warn(
      { sessionId: input.sessionId, owner: existing.userId, caller: input.userId },
      'Resume attempted by a different user — treating as NONE',
    );
    return { kind: 'NONE' };
  }

  switch (existing.status) {
    case 'completed':
      return { kind: 'REPLAY_DONE', session: existing };
    case 'streaming':
      // If it's still streaming AND the lock is fresh, it's a genuine conflict.
      const hasLock = !(await sessionStore.acquireSessionLock(existing.sessionId));
      // acquireSessionLock returns true if we got the lock. We WANT to fail
      // to acquire to detect an active stream, so invert:
      if (hasLock) {
        // We got the lock — no active stream. This means the original
        // stream crashed without clearing state. Treat as CONTINUE.
        return { kind: 'CONTINUE', session: existing };
      }
      return { kind: 'REJECT_CONFLICT', session: existing };
    case 'aborted':
    case 'failed':
      return { kind: 'CONTINUE', session: existing };
    default:
      return { kind: 'NONE' };
  }
}