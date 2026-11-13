/**
 * Handler: PayoutCompleted event.
 */

import type { OutboxEvent } from './consumer';
import { createLogger } from '@/utils/logger';
import { PermanentError, TransientError } from '@/utils/errors';
import { sendEmail } from '@/handlers/email.handler';
import { createInAppNotification } from '@/handlers/inapp.handler';
import { lookupUser } from '@/services/user-lookup.service';
import { config } from '@/config';

const log = createLogger('handler.payout_completed');

interface PayoutCompletedPayload {
  payoutId: string;
  authorId: string;
  authorEmail?: string;
  amount: string;
  currency: string;
  stripeTransferId?: string;
}

export async function handlePayoutCompleted(event: OutboxEvent): Promise<void> {
  const payload = event.payload as unknown as PayoutCompletedPayload;
  const { payoutId, authorId, amount, currency } = payload;

  if (!payoutId || !authorId) {
    throw new PermanentError(
      `PayoutCompleted missing fields: payoutId=${payoutId}, authorId=${authorId}`,
      'INVALID_PAYLOAD',
    );
  }

  log.info({ eventId: event.id, payoutId, authorId }, 'handling_payout_completed');

  // Resolve author email
  let email: string = payload.authorEmail ?? '';
  if (!email) {
    try {
      const info = await lookupUser(authorId);
      email = info?.email ?? '';
    } catch (err) {
      log.error({ err, authorId }, 'author_lookup_failed');
      throw new TransientError('Could not look up author', 'AUTHOR_LOOKUP_FAILED');
    }
  }

  if (!email) {
    log.warn({ payoutId, authorId }, 'author_email_missing_skip_email');
    return;
  }

  // Email
  try {
    await sendEmail({
      to: email,
      template: 'payout-sent',
      variables: {
        payoutId,
        amount,
        currency,
        transferId: payload.stripeTransferId ?? '',
        dashboardUrl: `${config.frontendUrl}/wallet/payouts/${payoutId}`,
      },
      idempotencyKey: `payout-email-${payoutId}`,
    });
  } catch (err) {
    if (err instanceof PermanentError) {
      log.error({ err, payoutId }, 'payout_email_permanent_failure');
    } else {
      throw err;
    }
  }

  // In-app
  try {
    await createInAppNotification({
      userId: authorId,
      type: 'payout_sent',
      title: 'Payout sent',
      body: `Your payout of ${amount} ${currency} has been sent.`,
      linkUrl: `/wallet/payouts/${payoutId}`,
      metadata: { payoutId },
      idempotencyKey: `payout-inapp-${payoutId}`,
    });
  } catch (err) {
    log.warn({ err, payoutId }, 'inapp_notification_failed');
  }

  log.info({ eventId: event.id, payoutId }, 'payout_completed_handled');
}