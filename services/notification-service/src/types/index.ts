/**
 * Centralized type definitions for notification-service.
 *
 * These are shared across consumers, handlers, and services.
 * Keeping them in one place prevents circular imports and makes
 * the contract obvious.
 */

// ============================================================
// KAFKA EVENTS
// ============================================================

/** Envelope of every outbox event (matches producer format). */
export interface OutboxEvent {
  id: string;
  type: string;
  aggregateId: string;
  occurredAt: string; // ISO 8601
  payload: Record<string, unknown>;
  meta?: EventMeta;
}

export interface EventMeta {
  service?: string;
  version?: string;
  requestId?: string;
  traceId?: string;
}

// ============================================================
// EVENT PAYLOADS
// ============================================================

export interface OrderPaidPayload {
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

export interface DraftPublishedPayload {
  draftId: string;
  ownerId: string;
  title?: string;
  contentType?: string;
  excerpt?: string;
  publishedAt?: string;
}

export interface PayoutCompletedPayload {
  payoutId: string;
  authorId: string;
  amount: string;
  currency: string;
  stripeTransferId?: string;
}

export interface ConnectStatusPayload {
  authorId: string;
  stripeAccountId: string;
  status: 'pending' | 'active' | 'restricted' | 'disabled';
  payoutsEnabled?: boolean;
  requirementsDue?: string[];
}

// ============================================================
// NOTIFICATION DOMAIN
// ============================================================

export type NotificationChannel = 'email' | 'push' | 'inapp';

export type NotificationType =
  | 'order_confirmation'
  | 'new_post'
  | 'payout_sent'
  | 'connect_status_change'
  | 'welcome'
  | 'dmca_notice';

export interface InAppNotification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  linkUrl?: string;
  metadata: Record<string, unknown>;
  readAt?: string;
  createdAt: string;
}

// ============================================================
// EMAIL
// ============================================================

export interface RenderedTemplate {
  subject: string;
  html: string;
  text: string;
}

export interface SendEmailInput {
  to: string;
  template: string;
  variables: Record<string, unknown>;
  idempotencyKey?: string;
}

// ============================================================
// PUSH
// ============================================================

export interface SendPushInput {
  userId: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  idempotencyKey?: string;
}