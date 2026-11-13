/**
 * Handler: DraftPublished event.
 *
 * Triggered when an author publishes a new book/article.
 * Notifies followers via:
 *   - In-app notification (batched — one per follower)
 *   - Email (respects per-recipient rate limit + dedup)
 *
 * DATA SOURCES (cross-database):
 *   - `users`   → auth-service (via /api/v1/users/:id/public)
 *   - `follows` → feed-service (via /api/v1/follows/:userId/followers)
 *
 * NOTE: This handler can be EXPENSIVE for authors with many followers.
 * We cap at 1000 recipients per event (rest handled by feed-service
 * fan-out). Emails are processed in batches of 10 with concurrency.
 */

import type { OutboxEvent } from './consumer';
import { createLogger } from '@/utils/logger';
import { PermanentError, TransientError } from '@/utils/errors';
import { sendEmail } from '@/handlers/email.handler';
import { createInAppNotification } from '@/handlers/inapp.handler';
import { checkEmailRateLimit } from '@/db/redis';
import { lookupUser } from '@/services/user-lookup.service';
import { fetchFollowers } from '@/services/feed-lookup.service';
import { config } from '@/config';

const log = createLogger('handler.book_published');

// ============================================================
// CONFIGURATION
// ============================================================
const MAX_RECIPIENTS = 1000;
const EMAIL_CONCURRENCY = 10;

// ============================================================
// TYPES
// ============================================================
interface DraftPublishedPayload {
  draftId: string;
  ownerId: string;
  title?: string;
  contentType?: string;
  excerpt?: string;
  publishedAt?: string;
}

// ============================================================
// HANDLER
// ============================================================
export async function handleBookPublished(event: OutboxEvent): Promise<void> {
  const payload = event.payload as unknown as DraftPublishedPayload;
  const { draftId, ownerId, title } = payload;

  if (!draftId || !ownerId) {
    throw new PermanentError(
      `DraftPublished missing required fields: draftId=${draftId}, ownerId=${ownerId}`,
      'INVALID_PAYLOAD',
    );
  }

  log.info({ eventId: event.id, draftId, ownerId }, 'handling_book_published');

  // ----- 1. Get author display name -----
  let authorName = 'An author';
  try {
    const info = await lookupUser(ownerId);
    authorName = info?.displayName ?? 'An author';
  } catch (err) {
    // Non-fatal — use default author name and continue
    log.warn({ err, ownerId }, 'author_lookup_failed_using_default');
  }

  // ----- 2. Get followers (IDs only) from feed-service -----
  let followerIds: string[];
  try {
    followerIds = await fetchFollowers(ownerId, MAX_RECIPIENTS);
  } catch (err) {
    log.error({ err, ownerId }, 'followers_lookup_failed');
    // Transient — retry via Kafka
    throw new TransientError(
      `Failed to fetch followers for ${ownerId}`,
      'FOLLOWERS_LOOKUP_FAILED',
    );
  }

  if (followerIds.length === 0) {
    log.info({ eventId: event.id, draftId }, 'no_followers_to_notify');
    return;
  }

  log.info(
    { eventId: event.id, draftId, followers: followerIds.length },
    'notifying_followers',
  );

  // ----- 3. Notify each follower (in batches) -----
  const dashboardUrl = `${config.frontendUrl}/posts/${draftId}`;
  let emailsSent = 0;
  let emailsSkipped = 0;
  let inAppCreated = 0;
  let emailErrors = 0;

  for (let i = 0; i < followerIds.length; i += EMAIL_CONCURRENCY) {
    const batch = followerIds.slice(i, i + EMAIL_CONCURRENCY);

    const results = await Promise.allSettled(
      batch.map(async (followerId) => {
        // 3a. In-app notification (best effort — never fail the event)
        let inAppOk = false;
        try {
          await createInAppNotification({
            userId: followerId,
            type: 'new_post',
            title: `${authorName} published a new post`,
            body: title ?? 'Check it out',
            linkUrl: `/posts/${draftId}`,
            metadata: { draftId, authorId: ownerId },
            idempotencyKey: `new-post-inapp-${draftId}-${followerId}`,
          });
          inAppOk = true;
        } catch (err) {
          log.debug({ err, followerId }, 'inapp_failed');
        }

        // 3b. Email (rate-limited, best effort per recipient)
        let emailOk = false;
        let emailSkipped = false;
        try {
          // Rate limit check
          const allowed = await checkEmailRateLimit(
            followerId,
            config.email.rateLimitPerHour,
          );
          if (!allowed) {
            emailSkipped = true;
            return { inAppOk, emailOk, emailSkipped };
          }

          // Resolve follower email via auth-service
          const info = await lookupUser(followerId);
          if (!info?.email) {
            emailSkipped = true;
            return { inAppOk, emailOk, emailSkipped };
          }

          // Send
          await sendEmail({
            to: info.email,
            template: 'new-post-notification',
            variables: {
              authorName,
              postTitle: title ?? 'New post',
              excerpt: payload.excerpt ?? '',
              url: dashboardUrl,
            },
            idempotencyKey: `new-post-email-${draftId}-${followerId}`,
          });
          emailOk = true;
        } catch (err) {
          // Per-recipient failures are non-fatal
          log.debug({ err, followerId }, 'email_failed');
        }

        return { inAppOk, emailOk, emailSkipped };
      }),
    );

    // Aggregate results
    for (const r of results) {
      if (r.status === 'fulfilled') {
        if (r.value.inAppOk) inAppCreated++;
        if (r.value.emailOk) emailsSent++;
        else if (r.value.emailSkipped) emailsSkipped++;
      } else {
        emailErrors++;
      }
    }
  }

  log.info(
    {
      eventId: event.id,
      draftId,
      totalFollowers: followerIds.length,
      inAppCreated,
      emailsSent,
      emailsSkipped,
      emailErrors,
    },
    'book_published_handled',
  );
}