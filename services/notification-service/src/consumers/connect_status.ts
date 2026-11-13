/**
 * Handler: ConnectStatusChanged event.
 */

import type { OutboxEvent } from './consumer';
import { createLogger } from '@/utils/logger';
import { PermanentError } from '@/utils/errors';
import { createInAppNotification } from '@/handlers/inapp.handler';
import { sendEmail } from '@/handlers/email.handler';
import { lookupUser } from '@/services/user-lookup.service';
import { config } from '@/config';

const log = createLogger('handler.connect_status');

interface ConnectStatusPayload {
  authorId: string;
  stripeAccountId: string;
  status: 'pending' | 'active' | 'restricted' | 'disabled';
  payoutsEnabled?: boolean;
  requirementsDue?: string[];
}

export async function handleConnectStatus(event: OutboxEvent): Promise<void> {
  const payload = event.payload as unknown as ConnectStatusPayload;
  const { authorId, status, payoutsEnabled } = payload;

  if (!authorId || !status) {
    throw new PermanentError(
      `ConnectStatusChanged missing fields: authorId=${authorId}, status=${status}`,
      'INVALID_PAYLOAD',
    );
  }

  log.info({ eventId: event.id, authorId, status }, 'handling_connect_status');

  // In-app
  try {
    const { title, body } = buildMessage(status, payoutsEnabled ?? false);
    await createInAppNotification({
      userId: authorId,
      type: 'connect_status_change',
      title,
      body,
      linkUrl: '/wallet/connect',
      metadata: { status, stripeAccountId: payload.stripeAccountId },
      idempotencyKey: `connect-status-inapp-${authorId}-${status}`,
    });
  } catch (err) {
    log.warn({ err, authorId }, 'inapp_notification_failed');
  }

  // Email only for active/restricted
  if (status === 'active' || status === 'restricted') {
    try {
      const info = await lookupUser(authorId);
      if (info?.email) {
        await sendEmail({
          to: info.email,
          template: 'connect-status',
          variables: {
            status,
            requirementsDue: (payload.requirementsDue ?? []).join(', '),
            dashboardUrl: `${config.frontendUrl}/wallet/connect`,
          },
          idempotencyKey: `connect-status-email-${authorId}-${status}`,
        });
      }
    } catch (err) {
      log.debug({ err, authorId }, 'connect_status_email_failed');
    }
  }

  log.info({ eventId: event.id, authorId, status }, 'connect_status_handled');
}

function buildMessage(
  status: string,
  payoutsEnabled: boolean,
): { title: string; body: string } {
  switch (status) {
    case 'active':
      return {
        title: 'Your payout account is ready',
        body: payoutsEnabled
          ? 'You can now receive payouts from your sales.'
          : 'Your account is active, but payouts are temporarily disabled.',
      };
    case 'restricted':
      return {
        title: 'Action required: Complete your Stripe onboarding',
        body: 'We need some additional information to enable payouts.',
      };
    case 'disabled':
      return {
        title: 'Your payout account is disabled',
        body: 'Please contact support.',
      };
    default:
      return {
        title: 'Payout account status updated',
        body: `Your account status is: ${status}`,
      };
  }
}