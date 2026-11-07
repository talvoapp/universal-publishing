/**
 * Outbox publisher — emits domain events to Kafka.
 *
 * This service is a PRODUCER (not a consumer). Events emitted:
 *
 *   - DraftSnapshotCreated   — a full snapshot was taken (every N ops)
 *   - DraftPublished         — status transitioned to `published`
 *   - DraftDeleted           — soft delete event
 *
 * Design:
 *   - We do NOT use the Transactional Outbox pattern for drafts, because
 *     the primary store is MongoDB (which has its own transactional
 *     guarantees) and Kafka is a downstream consumer, not the source of
 *     truth. Instead, we emit events AFTER the Mongo transaction commits,
 *     with at-least-once delivery semantics.
 *
 *   - If Kafka is down, events are buffered in a Redis list
 *     `outbox:buffer` (max 10,000 entries) and flushed on reconnect.
 *     This prevents losing important events (e.g., DraftPublished) when
 *     Kafka has a transient outage.
 *
 *   - Each event has a stable `id` (UUIDv4) so consumers can dedupe.
 *
 * Consumers:
 *   - feed-service       (DraftPublished → create feed items)
 *   - marketplace-service (DraftPublished → create sellable item)
 *   - notification-service (DraftPublished → notify followers)
 */

import { Kafka, Producer, logLevel, type CompressionTypes } from 'kafkajs';
import { randomUUID } from 'crypto';
import { config } from '@/config';
import { createLogger } from '@/utils/logger';
import { getRedisClient, key } from '@/db/redis';

const log = createLogger('outbox.publisher');

// ============================================================
// STATE
// ============================================================
let kafka: Kafka | null = null;
let producer: Producer | null = null;
let ready = false;

// ============================================================
// TYPES
// ============================================================
export interface OutboxEvent<T = unknown> {
  id: string;
  type: string;
  aggregateId: string;
  occurredAt: string; // ISO 8601
  payload: T;
  meta: {
    service: 'editor-service';
    version: string;
    traceId?: string;
  };
}

// ============================================================
// INIT
// ============================================================
export async function initOutboxPublisher(): Promise<void> {
  if (kafka && producer && ready) return;

  kafka = new Kafka({
    clientId: config.kafka.clientId,
    brokers: config.kafka.brokers,
    logLevel: logLevel.WARN,
    retry: {
      initialRetryTime: 300,
      retries: 10,
    },
  });

  producer = kafka.producer({
    // Emit each event once (best effort); Kafka's producer retries
    // internally, so we don't need to be aggressive here.
    idempotent: true,
    maxInFlightRequests: 1,
    allowAutoTopicCreation: false,
    transactionTimeout: 30_000,
  });

  producer.on('producer.connect', () => {
    log.info('Kafka producer connected');
  });
  producer.on('producer.disconnect', () => {
    log.warn('Kafka producer disconnected');
    ready = false;
  });

  await producer.connect();
  ready = true;

  // Attempt to flush any buffered events from a previous outage.
  void flushBuffer();
}

// ============================================================
// CLOSE
// ============================================================
export async function closeOutboxPublisher(): Promise<void> {
  if (producer) {
    try {
      // Flush pending before disconnecting.
      await flushBuffer().catch(() => undefined);
      await producer.disconnect();
      log.info('Kafka producer disconnected');
    } catch (err) {
      log.error({ err }, 'Error disconnecting Kafka producer');
    }
  }
  producer = null;
  kafka = null;
  ready = false;
}

// ============================================================
// EMIT
// ============================================================
/**
 * Emit an event to Kafka. If Kafka is down, buffer the event in Redis
 * for later delivery.
 */
export async function emit<T>(
  type: string,
  aggregateId: string,
  payload: T,
  opts: { traceId?: string } = {},
): Promise<void> {
  const event: OutboxEvent<T> = {
    id: randomUUID(),
    type,
    aggregateId,
    occurredAt: new Date().toISOString(),
    payload,
    meta: {
      service: 'editor-service',
      version: config.serviceVersion,
      ...(opts.traceId !== undefined ? { traceId: opts.traceId } : {}),
    },
  };

  const serialized = JSON.stringify(event);
  const partitionKey = aggregateId;

  if (!producer || !ready) {
    await bufferEvent(serialized);
    return;
  }

  try {
    await producer.send({
      topic: config.kafka.outboxTopic,
      compression: 1 as unknown as CompressionTypes, // GZIP
      messages: [
        {
          key: partitionKey,
          value: serialized,
          headers: {
            'event-type': type,
            'service': 'editor-service',
            'occurred-at': event.occurredAt,
            'event-id': event.id,
          },
        },
      ],
    });
    log.debug({ eventId: event.id, type, aggregateId }, 'Event emitted');
  } catch (err) {
    log.warn(
      { err, eventId: event.id, type },
      'Kafka emit failed — buffering event',
    );
    await bufferEvent(serialized);
  }
}

// ============================================================
// BUFFER (fallback during Kafka outage)
// ============================================================
const BUFFER_KEY = 'editor:outbox:buffer';
const BUFFER_MAX = 10_000;

async function bufferEvent(serialized: string): Promise<void> {
  try {
    const redis = getRedisClient();
    const len = await redis.llen(BUFFER_KEY);
    if (len >= BUFFER_MAX) {
      log.error(
        { bufferLen: len, max: BUFFER_MAX },
        'Outbox buffer is full — dropping oldest event',
      );
      await redis.lpop(BUFFER_KEY);
    }
    await redis.rpush(BUFFER_KEY, serialized);
  } catch (err) {
    // If Redis is also down, we truly lose the event. This is the last
    // line of defense — log loudly so ops can investigate.
    log.error({ err }, 'Failed to buffer event — event lost');
  }
}

async function flushBuffer(): Promise<void> {
  if (!producer || !ready) return;
  const redis = getRedisClient();

  // Drain in batches of 100, honoring Kafka's batch limit.
  for (let i = 0; i < 100; i++) {
    const serialized = await redis.lpop(BUFFER_KEY);
    if (!serialized) return;

    try {
      const event = JSON.parse(serialized) as OutboxEvent;
      await producer.send({
        topic: config.kafka.outboxTopic,
        compression: 1 as unknown as CompressionTypes,
        messages: [
          {
            key: event.aggregateId,
            value: serialized,
            headers: {
              'event-type': event.type,
              'service': 'editor-service',
              'occurred-at': event.occurredAt,
              'event-id': event.id,
            },
          },
        ],
      });
      log.info({ eventId: event.id, type: event.type }, 'Buffered event flushed');
    } catch (err) {
      // Put it back at the head and stop — we'll retry on the next flush.
      await redis.lpush(BUFFER_KEY, serialized);
      log.warn({ err }, 'Flush failed — remaining events stay buffered');
      return;
    }
  }
}