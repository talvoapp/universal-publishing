/**
 * Email handler — sends templated emails via SMTP.
 *
 * Flow:
 *   1. Check idempotency (Redis EXISTS — no reservation yet)
 *   2. Validate email format
 *   3. Render template (Handlebars)
 *   4. Send via SMTP (delegated to smtp.service)
 *   5. On success: reserve the idempotency key in Redis
 *   6. Transient failures throw TransientError (Kafka retries)
 *   7. Permanent failures throw PermanentError (mark processed, no retry)
 *
 * IDEMPOTENCY DESIGN:
 *   We check (EXISTS) but do NOT reserve the key until AFTER a
 *   successful SMTP send. This ensures:
 *     - Duplicate Kafka events are deduped (fast path)
 *     - Failed sends can be retried (no key was reserved)
 *
 * TRANSPORTER:
 *   All SMTP transport concerns (create, pool, close) live in
 *   `@/services/smtp.service`. This handler only uses the shared
 *   singleton — no local transport management.
 */

import { config } from '@/config';
import { createLogger } from '@/utils/logger';
import { getRedisClient, key } from '@/db/redis';
import { renderTemplate } from '@/services/template.service';
import { getTransporter } from '@/services/smtp.service';
import { PermanentError, TransientError } from '@/utils/errors';
import type { SendEmailInput, RenderedTemplate } from '@/types/index';

const log = createLogger('handler.email');

// Re-export type for backward compatibility
export type { SendEmailInput };

// ============================================================
// PUBLIC
// ============================================================
export async function sendEmail(input: SendEmailInput): Promise<void> {
  // ----- 1. Idempotency check (fast path, no reservation) -----
  if (input.idempotencyKey) {
    try {
      const redis = getRedisClient();
      const idemKey = key('email', 'idem', input.idempotencyKey);
      const exists = await redis.exists(idemKey);
      if (exists === 1) {
        log.debug(
          { idempotencyKey: input.idempotencyKey },
          'email_already_sent_skip',
        );
        return;
      }
    } catch (err) {
      // Redis error — fail open. We'll send and reserve (best effort).
      log.warn({ err }, 'idempotency_check_failed_failing_open');
    }
  }

  // ----- 2. Validate email -----
  if (!isValidEmail(input.to)) {
    throw new PermanentError(
      `Invalid email format: ${maskEmail(input.to)}`,
      'INVALID_EMAIL',
    );
  }

  // ----- 3. Render template -----
  let rendered: RenderedTemplate;
  try {
    rendered = await renderTemplate(input.template, input.variables);
  } catch (err) {
    log.error({ err, template: input.template }, 'template_render_failed');
    throw new PermanentError(
      `Template rendering failed: ${input.template}`,
      'TEMPLATE_RENDER_FAILED',
    );
  }

  // ----- 4. Send via SMTP -----
  let messageId: string;
  try {
    const info = await getTransporter().sendMail({
      from: `"${config.smtp.fromName}" <${config.smtp.from}>`,
      to: input.to,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
    });
    messageId = info.messageId;

    log.info(
      {
        messageId,
        to: maskEmail(input.to),
        template: input.template,
      },
      'email_sent',
    );
  } catch (err) {
    const e = err as NodeJS.ErrnoException & {
      responseCode?: number;
      code?: string;
    };

    // Permanent errors — don't retry
    if (
      e.responseCode === 550 ||
      e.code === 'EENVELOPE' ||
      e.code === 'EINVALID'
    ) {
      log.warn(
        { err, to: maskEmail(input.to), code: e.code },
        'email_permanent_failure',
      );
      throw new PermanentError(
        `Email rejected: ${e.message}`,
        'EMAIL_REJECTED',
      );
    }

    // Transient errors — retry
    log.warn(
      { err, to: maskEmail(input.to), code: e.code },
      'email_transient_failure',
    );
    throw new TransientError(`SMTP error: ${e.message}`, 'SMTP_ERROR');
  }

  // ----- 5. Reserve idempotency key (only AFTER successful send) -----
  if (input.idempotencyKey) {
    try {
      const redis = getRedisClient();
      const idemKey = key('email', 'idem', input.idempotencyKey);
      await redis.set(idemKey, messageId, 'EX', 86400);
    } catch (err) {
      log.warn({ err }, 'idempotency_reserve_failed_after_send');
    }
  }
}

// ============================================================
// HELPERS
// ============================================================
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '[invalid]';
  const visible = local.slice(0, 2);
  return `${visible}${'*'.repeat(Math.max(1, local.length - 2))}@${domain}`;
}