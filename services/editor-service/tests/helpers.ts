/**
 * Test helpers for editor-service.
 * (Referenced by both draft.test.ts and websocket.test.ts.)
 */

import { Types } from 'mongoose';
import { WebSocket } from 'ws';
import { DraftModel } from '@/models/Draft.model';
import { signAccessToken } from './token-helper';

// ============================================================
// USERS
// ============================================================
export interface TestUser {
  id: string;
  email: string;
  role: 'reader' | 'author' | 'editor' | 'admin';
  emailVerified: boolean;
  accessToken: string;
}

export async function createTestUser(
  opts: { role?: TestUser['role']; emailVerified?: boolean } = {},
): Promise<TestUser> {
  const id = new Types.ObjectId().toString();
  const email = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const role = opts.role ?? 'author';
  const emailVerified = opts.emailVerified ?? true;
  const accessToken = signAccessToken({ sub: id, email, role, emailVerified });
  return { id, email, role, emailVerified, accessToken };
}

// ============================================================
// DRAFTS
// ============================================================
export interface TestDraft {
  id: string;
}

export async function createTestDraft(
  ownerId: string,
  opts: {
    title?: string;
    content?: string;
    version?: number;
    contentType?: 'article' | 'book' | 'news_post';
    status?: 'draft' | 'published' | 'archived';
  } = {},
): Promise<TestDraft> {
  const content = opts.content ?? 'Default draft content. '.repeat(20);
  const doc = await DraftModel.create({
    ownerId: new Types.ObjectId(ownerId),
    title: opts.title ?? 'Test Draft',
    contentType: opts.contentType ?? 'article',
    language: 'en-US',
    content,
    metadata: {},
    status: opts.status ?? 'draft',
    version: opts.version ?? 0,
    opCountSinceSnapshot: 0,
  });
  return { id: doc._id.toString() };
}

// ============================================================
// WEBSOCKET FRAME WAITING
// ============================================================
export function waitForFrame(
  ws: WebSocket,
  type: string,
  timeoutMs = 5000,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.off('message', onMessage);
      reject(new Error(`Timeout waiting for frame type "${type}"`));
    }, timeoutMs);

    function onMessage(raw: WebSocket.RawData): void {
      try {
        const data = JSON.parse(raw.toString()) as { type?: string };
        if (data.type === type) {
          clearTimeout(timeout);
          ws.off('message', onMessage);
          resolve(data as Record<string, unknown>);
        }
      } catch {
        // ignore parse errors — other frames may be in-flight
      }
    }

    ws.on('message', onMessage);
  });
}