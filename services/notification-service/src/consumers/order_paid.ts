/**
 * Handler: OrderPaid event.
 */

import type { OutboxEvent } from './consumer';
import { createLogger } from '@/utils/logger';
import { PermanentError, TransientError } from '@/utils/errors';
import { sendEmail } from '@/handlers/email.handler';
import { createInAppNotification } from '@/handlers/inapp.handler';
import { lookupUser } from '@/services/user-lookup.service';
import { config } from '@/config';

const log = createLogger('handler.order_paid');

interface OrderPaidPayload {
  orderId: string;
  buyerId: string;
  authorId?: string;
  buyerEmail?: string; // ← prefer if present in payload
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
  const payload = event.payload as unknown as OrderPaidPayload;
  const { orderId, buyerId, itemId, itemTitle } = payload;

  if (!orderId || !buyerId || !itemId) {
    throw new PermanentError(
      `OrderPaid missing required fields: orderId=${orderId}, buyerId=${buyerId}, itemId=${itemId}`,
      'INVALID_PAYLOAD',
    );
  }

  log.info({ eventId: event.id, orderId, buyerId }, 'handling_order_paid');

  // 1. Resolve buyer email
  let email: string = payload.buyerEmail ?? '';
  if (!email) {
    try {
      const info = await lookupUser(buyerId);
      email = info?.email ?? '';
    } catch (err) {
      log.error({ err, buyerId }, 'buyer_lookup_failed');
      throw new TransientError('Could not look up buyer', 'BUYER_LOOKUP_FAILED');
    }
  }

  if (!email) {
    log.warn({ orderId, buyerId }, 'buyer_email_missing_skip_email');
  }

  // 2. Send email
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
          dashboardUrl: `${config.frontendUrl}/orders/${orderId}`,
        },
        idempotencyKey: `order-paid-email-${orderId}`,
      });
    } catch (err) {
      if (err instanceof PermanentError) {
        log.error({ err, orderId }, 'order_email_permanent_failure');
      } else {
        log.warn({ err, orderId }, 'order_email_transient_failure');
        throw err;
      }
    }
  }

  // 3. In-app
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
  }

  log.info({ eventId: event.id, orderId }, 'order_paid_handled');
}