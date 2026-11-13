/**
 * Kafka consumer — the heart of notification-service.
 *
 * SASL/SSL:
 *   When KAFKA_SECURITY_PROTOCOL is SASL_SSL or SASL_PLAINTEXT, we
 *   configure kafkajs with `ssl: true` + `sasl: { mechanism, username, password }`.
 *   For plaintext, we omit both.
 */

import { Kafka, logLevel, type Consumer, type EachMessagePayload } from 'kafkajs';
import { config } from '@/config';
import { createLogger } from '@/utils/logger';
import { captureException } from '@/utils/sentry';
import { query } from '@/db/postgres';
import { PermanentError, TransientError } from '@/utils/errors';

import { handleOrderPaid } from './order_paid';
import { handleBookPublished } from './book_published';
import { handlePayoutCompleted } from './payout_completed';
import { handleConnectStatus } from './connect_status';

const log = createLogger('kafka.consumer');

// ============================================================
// STATE
// ============================================================
let kafka: Kafka | null = null;
let consumer: Consumer | null = null;
let isRunning = false;
let lastHeartbeat = 0;

// ============================================================
// EVENT TYPES
// ============================================================
export interface OutboxEvent {
  id: string;
  type: string;
  aggregateId: string;
  occurredAt: string;
  payload: Record<string, unknown>;
  meta?: {
    service?: string;
    version?: string;
    requestId?: string;
    traceId?: string;
  };
}

// ============================================================
// HEALTH
// ============================================================
export function getConsumerHealth(): boolean {
  if (!isRunning || !consumer) return false;
  return Date.now() - lastHeartbeat < 60_000;
}

// ============================================================
// LIFECYCLE
// ============================================================
export async function createConsumer(): Promise<Consumer> {
  if (consumer) return consumer;

  // Build SASL config (only if enabled)
  let sasl: { mechanism: string; username: string; password: string } | undefined;
  let ssl: boolean | undefined;

  if (config.kafka.saslEnabled) {
    if (config.kafka.securityProtocol === 'SASL_SSL') {
      ssl = true;
    }
    sasl = {
      mechanism: config.kafka.saslMechanism || 'plain',
      username: config.kafka.saslUsername,
      password: config.kafka.saslPassword,
    };
    log.info(
      {
        protocol: config.kafka.securityProtocol,
        mechanism: config.kafka.saslMechanism,
        brokers: config.kafka.brokers,
      },
      'kafka_sasl_enabled',
    );
  } else {
    log.info({ brokers: config.kafka.brokers }, 'kafka_plaintext_enabled');
  }

  kafka = new Kafka({
    clientId: config.kafka.clientId,
    brokers: config.kafka.brokers,
    logLevel: logLevel.WARN,
    ...(ssl !== undefined ? { ssl } : {}),
    ...(sasl ? { sasl: sasl as never } : {}),
    retry: {
      initialRetryTime: 300,
      retries: 10,
    },
  });

  consumer = kafka.consumer({
    groupId: config.kafka.consumerGroup,
    sessionTimeout: 30_000,
    heartbeatInterval: 3_000,
    maxWaitTimeInMs: 500,
  });

  await consumer.connect();
  log.info(
    {
      group: config.kafka.consumerGroup,
      topic: config.kafka.outboxTopic,
    },
    'kafka_consumer_connected',
  );

  await consumer.subscribe({
    topic: config.kafka.outboxTopic,
    fromBeginning: false,
  });

  return consumer;
}

export async function closeConsumer(): Promise<void> {
  if (!consumer) return;
  isRunning = false;
  try {
    await consumer.disconnect();
    log.info('kafka_consumer_disconnected');
  } catch (err) {
    log.error({ err }, 'Error disconnecting Kafka consumer');
  }
  consumer = null;
  kafka = null;
}

// ============================================================
// START / STOP
// ============================================================
export async function start(): Promise<void> {
  if (!consumer) {
    throw new Error('Consumer not created. Call createConsumer() first.');
  }
  if (isRunning) return;

  isRunning = true;
  lastHeartbeat = Date.now();

  await consumer.run({
    eachMessage: async (payload: EachMessagePayload) => {
      await handleMessage(payload);
    },
  });

  log.info('kafka_consumer_running');
}

// ============================================================
// MESSAGE HANDLING
// ============================================================
async function handleMessage(payload: EachMessagePayload): Promise<void> {
  lastHeartbeat = Date.now();

  const { message, partition, topic } = payload;
  const raw = message.value?.toString() ?? '';
  const offset = message.offset;

  // 1. Parse
  let event: OutboxEvent;
  try {
    event = JSON.parse(raw) as OutboxEvent;
  } catch (err) {
    log.error(
      { err, offset, partition, topic, raw: raw.slice(0, 500) },
      'kafka_invalid_json',
    );
    return;
  }

  if (!event.id || !event.type) {
    log.warn({ offset, partition, event }, 'kafka_incomplete_event');
    return;
  }

  // 2. Idempotency check (Postgres)
  try {
    const { rows } = await query<{ exists: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM processed_events WHERE event_id = $1) AS exists`,
      [event.id],
    );
    if (rows[0]?.exists) {
      log.debug({ eventId: event.id, type: event.type }, 'event_already_processed');
      return;
    }
  } catch (err) {
    log.error({ err, eventId: event.id }, 'idempotency_check_failed');
    throw err;
  }

  // 3. Dispatch
  log.info(
    { eventId: event.id, type: event.type, aggregateId: event.aggregateId },
    'event_received',
  );

  try {
    await dispatchEvent(event);
  } catch (err) {
    if (err instanceof TransientError) {
      log.warn(
        { err, eventId: event.id, type: event.type },
        'transient_error_will_retry',
      );
      throw err;
    }

    if (err instanceof PermanentError) {
      log.error(
        { err, eventId: event.id, type: event.type },
        'permanent_error_will_mark_processed',
      );
      await markProcessed(event.id, event.type, 'permanent_error');
      return;
    }

    log.error(
      { err, eventId: event.id, type: event.type },
      'unexpected_error_treating_as_transient',
    );
    captureException(err, { eventId: event.id, eventType: event.type });
    throw err;
  }

  // 4. Mark processed (single INSERT, no transaction needed)
  await markProcessed(event.id, event.type, 'success');
}

// ============================================================
// DISPATCH
// ============================================================
async function dispatchEvent(event: OutboxEvent): Promise<void> {
  switch (event.type) {
    case 'OrderPaid':
      await handleOrderPaid(event);
      return;
    case 'DraftPublished':
      await handleBookPublished(event);
      return;
    case 'PayoutCompleted':
      await handlePayoutCompleted(event);
      return;
    case 'ConnectStatusChanged':
      await handleConnectStatus(event);
      return;
    case 'SubscriptionCanceled':
      log.debug({ eventId: event.id }, 'subscription_canceled_not_yet_implemented');
      return;
    default:
      log.debug({ eventId: event.id, type: event.type }, 'event_ignored');
  }
}

// ============================================================
// MARK PROCESSED
// ============================================================
async function markProcessed(
  eventId: string,
  eventType: string,
  status: string,
): Promise<void> {
  try {
    // Single statement — no transaction needed
    await query(
      `INSERT INTO processed_events (event_id, event_type, status, processed_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (event_id) DO NOTHING`,
      [eventId, eventType, status],
    );
  } catch (err) {
    log.error({ err, eventId }, 'mark_processed_failed');
  }
}