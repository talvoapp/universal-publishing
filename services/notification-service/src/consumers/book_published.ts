/**
 * Handler: DraftPublished event.
 *
 * Triggered when an author publishes a new book/article.
 * Notifies followers via:
 *   - In-app notification (batched — one per follower)
 *   - Email (respects per-recipient rate limit + dedup)
 *
 * NOTE: This handler can be EXPENSIVE for authors with many followers.
 * We cap it at 1000 recipients per event (rest handled by feed-service).
 */

import type { OutboxEvent } from './consumer';
import { createLogger } from '@/utils/logger';
import { PermanentError } from '@/utils/errors';
import { sendEmail } from '@/handlers/email.handler';
import { createInAppNotification } from '@/handlers/inapp.handler';
import { query } from '@/db/postgres';
import { checkEmailRateLimit } from '@/db/redis';
import { config } from '@/config';

const log = createLogger('handler.book_published');

// Safety cap — don't notify more than this many followers per event
const MAX_RECIPIENTS = 1000;

interface DraftPublishedPayload {
  draftId: string;
  ownerId: string;
  title?: string;
  contentType?: string;
  excerpt?: string;
  publishedAt?: string;
}

export async function handleBookPublished(event: OutboxEvent): Promise<void> {
  const payload = event.payload as DraftPublishedPayload;
  const { draftId, ownerId, title } = payload;

  if (!draftId || !ownerId) {
    throw new PermanentError(
      `DraftPublished missing required fields: draftId=${draftId}, ownerId=${ownerId}`,
      'INVALID_PAYLOAD',
    );
  }

  log.info({ eventId: event.id, draftId, ownerId }, 'handling_book_published');

  // ----- 1. Get author info -----
  let authorName = 'An author';
  try {
    const { rows } = await query<{ display_name: string }>(
      `SELECT display_name FROM users WHERE id = $1 LIMIT 1`,
      [ownerId],
    );
    authorName = rows[0]?.display_name ?? 'An author';
  } catch (err) {
    log.warn({ err, ownerId }, 'author_lookup_failed');
  }

  // ----- 2. Get followers (bounded) -----
  let followers: Array<{ follower_id: string; email: string }>;
  try {
    const { rows } = await query<{ follower_id: string; email: string }>(
      `SELECT f.follower_id, u.email
       FROM follows f
       JOIN users u ON u.id = f.follower_id
       WHERE f.followee_id = $1
         AND f.status = 'active'
         AND u.deleted_at IS NULL
       LIMIT $2`,
      [ownerId, MAX_RECIPIENTS],
    );
    followers = rows;
  } catch (err) {
    log.error({ err, ownerId }, 'followers_lookup_failed');
    throw err; // transient
  }

  if (followers.length === 0) {
    log.info({ eventId: event.id, draftId }, 'no_followers_to_notify');
    return;
  }

  log.info(
    { eventId: event.id, draftId, followers: followers.length },
    'notifying_followers',
  );

  // ----- 3. Notify each follower (in-app always, email best-effort) -----
  const dashboardUrl = `${config.frontendUrl}/posts/${draftId}`;
  let emailsSent = 0;
  let emailsSkipped = 0;
  let inAppCreated = 0;

  for (const follower of followers) {
    // In-app (best effort)
    try {
      await createInAppNotification({
        userId: follower.follower_id,
        type: 'new_post',
        title: `${authorName} published a new post`,
        body: title ?? 'Check it out',
        linkUrl: `/posts/${draftId}`,
        metadata: { draftId, authorId: ownerId },
        idempotencyKey: `new-post-inapp-${draftId}-${follower.follower_id}`,
      });
      inAppCreated++;
    } catch (err) {
      log.debug({ err, followerId: follower.follower_id }, 'inapp_failed');
    }

    // Email (rate-limited)
    if (!follower.email) {
      emailsSkipped++;
      continue;
    }

    try {
      const allowed = await checkEmailRateLimit(
        follower.follower_id,
        config.email.rateLimitPerHour,
      );
      if (!allowed) {
        emailsSkipped++;
        continue;
      }

      await sendEmail({
        to: follower.email,
        template: 'new-post-notification',
        variables: {
          authorName,
          postTitle: title ?? 'New post',
          excerpt: payload.excerpt ?? '',
          url: dashboardUrl,
        },
        idempotencyKey: `new-post-email-${draftId}-${follower.follower_id}`,
      });
      emailsSent++;
    } catch (err) {
      // Per-recipient email errors are non-fatal — log and continue
      log.debug({ err, followerId: follower.follower_id }, 'email_failed');
      emailsSkipped++;
    }
  }

  log.info(
    {
      eventId: event.id,
      draftId,
      totalFollowers: followers.length,
      emailsSent,
      emailsSkipped,
      inAppCreated,
    },
    'book_published_handled',
  );
}