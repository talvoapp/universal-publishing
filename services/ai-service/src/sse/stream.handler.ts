/**
 * SSE stream handler — the orchestrator for `POST /ai/suggest`.
 *
 * Responsibilities:
 *   1. Decide resume behavior based on sessionId (see resume.service).
 *   2. Open the SSE response (headers, flushHeaders).
 *   3. Emit a keepalive `ping` every N seconds (config.sse.heartbeatIntervalMs).
 *   4. Call `fallback.service.run()` and pipe chunks to the client.
 *   5. Track accumulated text in the session store (for resume).
 *   6. Handle abort (client closed) — cancel upstream, mark session.
 *   7. Handle hard timeout (config.sse.maxStreamDurationMs) — terminate
 *      gracefully with a `done` event (not `error` — the client didn't fail).
 *   8. Update quota: on success, record actual token usage.
 *   9. Clean up: clear timers, release lock, flush session.
 *
 * `closeAllStreams()` is called during graceful shutdown — it terminates
 * every in-flight stream with a `server_shutting_down` error event.
 */

import type { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { config } from '@/config';
import { createLogger } from '@/utils/logger';
import {
  setSSEHeaders,
  writeChunk,
  writeUsage,
  writeDone,
  writeError,
  writePing,
} from './events';
import * as sessionStore from './session-store';
import * as resumeService from '@/services/resume.service';
import * as fallbackService from '@/services/fallback.service';
import * as quotaService from '@/services/quota.service';
import type { SuggestInput } from '@/types/index';
import type { ReserveResult } from '@/services/quota.service';
import type { AuthRole } from '@/utils/jwt.util';

const log = createLogger('sse.stream');

// ============================================================
// ACTIVE STREAMS REGISTRY (for graceful shutdown)
// ============================================================
interface ActiveStream {
  abort: AbortController;
  sessionId: string;
  res: Response;
}

const activeStreams = new Set<ActiveStream>();

// ============================================================
// MAIN ENTRY
// ============================================================
export interface HandleSuggestInput {
  req: Request;
  res: Response;
  user: { id: string; role: AuthRole };
  input: SuggestInput;
  quota: ReserveResult;
}

export async function handleSuggestStream(
  args: HandleSuggestInput,
): Promise<void> {
  const { req, res, user, input, quota } = args;

  // ----- 1. Decide resume behavior -----
  const decision = await resumeService.decide({
    sessionId: input.sessionId,
    userId: user.id,
  });

  if (decision.kind === 'REJECT_CONFLICT') {
    res.status(409).json({
      type: 'https://httpstatuses.io/409',
      title: 'Conflict',
      status: 409,
      code: 'SESSION_IN_USE',
      detail: 'A stream is already active for this sessionId',
      instance: req.id,
    });
    return;
  }

  // ----- 2. Fast path: replay completed session (idempotent) -----
  if (decision.kind === 'REPLAY_DONE') {
    setSSEHeaders(res);
    writeChunk(res, { delta: decision.session.accumulated, index: 0 });
    writeUsage(res, {
      tokens_in: decision.session.tokensIn,
      tokens_out: decision.session.tokensOut,
      model: decision.session.model ?? 'unknown',
      quota_remaining: quota.remaining,
    });
    writeDone(res, {
      session_id: decision.session.sessionId,
      finish_reason: 'replay',
    });
    res.end();
    return;
  }

  // ----- 3. Create or reuse session -----
  const sessionId = decision.kind === 'CONTINUE'
    ? decision.session.sessionId
    : (input.sessionId ?? randomUUID());

  const session = decision.kind === 'CONTINUE'
    ? decision.session
    : await sessionStore.createSession({
        sessionId,
        userId: user.id,
        operation: input.operation,
      });

  // ----- 4. Acquire lock (again — new sessions need it too) -----
  const gotLock = await sessionStore.acquireSessionLock(sessionId);
  if (!gotLock) {
    res.status(409).json({
      type: 'https://httpstatuses.io/409',
      title: 'Conflict',
      status: 409,
      code: 'SESSION_IN_USE',
      detail: 'A stream is already active for this sessionId',
      instance: req.id,
    });
    return;
  }

  // ----- 5. Set up SSE response -----
  setSSEHeaders(res);

  // ----- 6. Register abort + active stream -----
  const abort = new AbortController();
  const active: ActiveStream = { abort, sessionId, res };
  activeStreams.add(active);

  let clientGone = false;
  req.on('close', () => {
    if (!clientGone) {
      clientGone = true;
      log.info({ sessionId, requestId: req.id }, 'Client disconnected — aborting upstream');
      abort.abort();
    }
  });

  // ----- 7. Keepalive timer -----
  const keepalive = setInterval(() => {
    if (res.writableEnded) return;
    writePing(res);
  }, config.sse.heartbeatIntervalMs);
  keepalive.unref();

  // ----- 8. Hard timeout -----
  const hardTimeout = setTimeout(() => {
    log.warn({ sessionId }, 'Stream exceeded max duration — terminating');
    abort.abort();
  }, config.sse.maxStreamDurationMs);
  hardTimeout.unref();

  // ----- 9. Resume-prefix replay (CONTINUE case) -----
  let startIndex = 0;
  if (decision.kind === 'CONTINUE' && decision.session.accumulated.length > 0) {
    // Replay accumulated prefix so client catches up.
    writeChunk(res, { delta: decision.session.accumulated, index: 0 });
    startIndex = 1;
    log.info(
      { sessionId, prefixLen: decision.session.accumulated.length },
      'Replayed prefix for resume',
    );
  }

  // ----- 10. Run the fallback orchestrator -----
  let index = startIndex;
  let totalChars = 0;

  try {
    const result = await fallbackService.run({
      input,
      signal: abort.signal,
      onChunk: async (chunk) => {
        if (clientGone) return;
        // Enforce output cap
        totalChars += chunk.delta.length;
        if (totalChars > config.sse.maxOutputChars) {
          log.warn(
            { sessionId, totalChars, cap: config.sse.maxOutputChars },
            'Output cap reached — terminating stream',
          );
          abort.abort();
          return;
        }
        writeChunk(res, { delta: chunk.delta, index });
        await sessionStore.appendChunk(session, chunk.delta);
        index += 1;
      },
    });

    // ----- 11a. Success: mark completed, send usage + done -----
    await sessionStore.markCompleted(session, {
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      provider: result.provider,
      model: result.model,
    });

    // Adjust quota from reserved → actual.
    await quotaService.recordActualUsage({
      userId: user.id,
      reserved: quota.reserved,
      actual: result.tokensIn + result.tokensOut,
    });

    if (!clientGone && !res.writableEnded) {
      writeUsage(res, {
        tokens_in: result.tokensIn,
        tokens_out: result.tokensOut,
        model: result.model,
        quota_remaining: Math.max(0, quota.remaining - (result.tokensIn + result.tokensOut)),
      });
      writeDone(res, {
        session_id: sessionId,
        finish_reason: result.finishReason,
      });
      res.end();
    }

    log.info(
      {
        sessionId,
        provider: result.provider,
        model: result.model,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        chunks: index,
        durationMs: Date.now() - new Date(session.startedAt).getTime(),
      },
      'Stream completed',
    );
  } catch (err) {
    // ----- 11b. Failure path -----
    if (isAbort(err) || clientGone) {
      await sessionStore.markAborted(session);
      log.info({ sessionId }, 'Stream aborted by client');
    } else {
      await sessionStore.markFailed(session, err instanceof Error ? err.message : 'unknown');
      log.error({ err, sessionId }, 'Stream failed');
      if (!res.writableEnded) {
        writeError(res, {
          code: 'ai_unavailable',
          retryable: true,
          detail: 'The AI service is temporarily unavailable. Please retry.',
        });
        res.end();
      }
    }
  } finally {
    // ----- 12. Cleanup -----
    clearInterval(keepalive);
    clearTimeout(hardTimeout);
    activeStreams.delete(active);
    await sessionStore.releaseSessionLock(sessionId);
  }
}

// ============================================================
// GRACEFUL SHUTDOWN
// ============================================================
/**
 * Called from `index.ts` during SIGTERM/SIGINT.
 * Sends a `server_shutting_down` error event to every active stream
 * so clients know to retry, then ends the response.
 */
export async function closeAllStreams(reason: string): Promise<void> {
  if (activeStreams.size === 0) return;
  log.info({ count: activeStreams.size, reason }, 'Closing all active streams');

  for (const stream of activeStreams) {
    try {
      if (!stream.res.writableEnded) {
        writeError(stream.res, {
          code: reason,
          retryable: true,
          detail: 'The server is restarting. Please retry.',
        });
        stream.res.end();
      }
    } catch (err) {
      log.warn({ err, sessionId: stream.sessionId }, 'Error closing stream');
    }
    stream.abort.abort();
  }

  // Give the event loop a tick to flush socket writes.
  await new Promise((resolve) => setTimeout(resolve, 100));
  activeStreams.clear();
}

// ============================================================
// HELPERS
// ============================================================
function isAbort(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return err.name === 'AbortError' || /abort/i.test(err.message);
}