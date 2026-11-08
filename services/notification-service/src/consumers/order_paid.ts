/**
 * Handler: OrderPaid event.
 *
 * Triggered when marketplace-service completes a purchase.
 * Sends:
 *   - Confirmation email to the buyer
 *   - In-app notification (for the buyer's inbox)
 */

import type { OutboxEvent } from './consumer';
import { createLogger } from '@/utils/logger';
import { PermanentError, TransientError } from '@/utils/errors';
import { sendEmail } from '@/handlers/email.handler';
import { createInAppNotification } from '@/handlers/inapp.handler';
import { query } from '@/db/postgres';

const log = createLogger('handler.order_paid');

interface OrderPaidPayload {
  orderId: string;
  buyerId: string;
  authorId?: string;
  itemId: string;
  itemTitle?: string;
  amount?: {
    subtotal?: string;
    taxAmount?: string;
    total?: string;
    currency?: string;
  };
  stripePaymentIntentId?: string;
  requestId?: string;
}

export async function handleOrderPaid(event: OutboxEvent): Promise<void> {
  const payload = event.payload as OrderPaidPayload;
  const { orderId, buyerId, itemId, itemTitle } = payload;

  if (!orderId || !buyerId || !itemId) {
    throw new PermanentError(
      `OrderPaid missing required fields: orderId=${orderId}, buyerId=${buyerId}, itemId=${itemId}`,
      'INVALID_PAYLOAD',
    );
  }

  log.info({ eventId: event.id, orderId, buyerId }, 'handling_order_paid');

  // ----- 1. Look up buyer's email -----
  let email = '';
  try {
    const { rows } = await query<{ email: string }>(
      `SELECT email FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [buyerId],
    );
    email = rows[0]?.email ?? '';
  } catch (err) {
    log.error({ err, buyerId }, 'buyer_lookup_failed');
    throw new TransientError('Could not look up buyer', 'BUYER_LOOKUP_FAILED');
  }

  if (!email) {
    // Buyer not found — skip email, but still create in-app (best effort)
    log.warn({ orderId, buyerId }, 'buyer_not_found_skip_email');
  }

  // ----- 2. Send email (if we have an email) -----
  if (email) {
    try {
      await sendEmail({
        to: email,
        template: 'order-confirmation',
        variables: {
          orderId,
          itemTitle: itemTitle ?? 'Your purchase',
          total: payload.amount?.total ?? '—',
          currency: payload.amount?.currency ?? 'USD',
          dashboardUrl: `${process.env.FRONTEND_URL ?? 'http://localhost:3000'}/orders/${orderId}`,
        },
        idempotencyKey: `order-paid-email-${orderId}`,
      });
    } catch (err) {
      if (err instanceof PermanentError) {
        // Invalid email — skip, don't retry
        log.error({ err, orderId, email }, 'order_email_permanent_failure');
      } else {
        // Transient — retry via Kafka
        log.warn({ err, orderId }, 'order_email_transient_failure');
        throw err;
      }
    }
  }

  // ----- 3. Create in-app notification -----
  try {
    await createInAppNotification({
      userId: buyerId,
      type: 'order_confirmation',
      title: 'Order confirmed',
      body: `Your order for "${itemTitle ?? 'an item'}" is confirmed.`,
      linkUrl: `/orders/${orderId}`,
      metadata: { orderId, itemId },
      idempotencyKey: `order-paid-inapp-${orderId}`,
    });
  } catch (err) {
    log.warn({ err, orderId }, 'inapp_notification_failed');
    // Non-fatal — don't retry the whole event for in-app failure
  }

  log.info({ eventId: event.id, orderId }, 'order_paid_handled');
}