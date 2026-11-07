"""
RabbitMQ consumer — the heart of formatting-service.

Lifecycle:
    1. Connect to RabbitMQ (with retries)
    2. Declare the durable queue + exchange
    3. Set QoS (prefetch)
    4. Start consuming
    5. For each message:
        a. Parse JSON
        b. Validate shape (job_type, draft_id, output_formats)
        c. Dispatch to the appropriate handler
        d. ACK on success, NACK (requeue) on transient failure,
           NACK (dead-letter) on permanent failure
    6. On shutdown: cancel consumer, close channel, close connection

The dispatch handlers live in `app/workers/*` (this file stays generic).
"""

from __future__ import annotations

import asyncio
import json
import signal
from typing import Any, Callable

import pika
from pika.adapters.blocking_connection import BlockingChannel
from pika.spec import Basic, BasicProperties

from app.config import settings
from app.utils.logger import get_logger


log = get_logger(__name__)


# ============================================================
# HANDLER REGISTRY
# ============================================================
Handler = Callable[[dict[str, Any]], None]

_registry: dict[str, Handler] = {}


def register_handler(job_type: str, handler: Handler) -> None:
    """Register a handler for a specific job_type."""
    _registry[job_type] = handler
    log.info("registered_handler", job_type=job_type)


# ============================================================
# CONSUMER
# ============================================================
class FormattingConsumer:
    """Blocking RabbitMQ consumer with graceful shutdown."""

    def __init__(self) -> None:
        self._connection: pika.BlockingConnection | None = None
        self._channel: BlockingChannel | None = None
        self._stopping = False

    # --------------------------------------------------------
    # LIFECYCLE
    # --------------------------------------------------------
    def start(self) -> None:
        """Connect, declare queue, and block on consumption."""
        self._stopping = False
        self._connect()
        self._declare_queue()
        self._channel.basic_qos(prefetch_count=settings.rabbitmq_prefetch)
        self._channel.basic_consume(
            queue=settings.rabbitmq_queue,
            on_message_callback=self._on_message,
            auto_ack=False,
        )

        log.info(
            "consumer_started",
            queue=settings.rabbitmq_queue,
            prefetch=settings.rabbitmq_prefetch,
        )

        # Signal handlers → request graceful stop on next poll cycle.
        for sig in (signal.SIGTERM, signal.SIGINT):
            try:
                signal.signal(sig, self._signal_handler)
            except ValueError:
                # Signal can only be set in main thread — safe to skip in tests.
                pass

        try:
            self._channel.start_consuming()
        except KeyboardInterrupt:
            self.stop()

    def stop(self) -> None:
        """Graceful shutdown: finish current message, then close."""
        if self._stopping:
            return
        self._stopping = True
        log.info("consumer_stopping")

        try:
            if self._channel and self._channel.is_open:
                self._channel.stop_consuming()
        except Exception as e:  # noqa: BLE001
            log.warning("stop_consuming_failed", error=str(e))

        try:
            if self._connection and self._connection.is_open:
                self._connection.close()
        except Exception as e:  # noqa: BLE001
            log.warning("close_connection_failed", error=str(e))

        log.info("consumer_stopped")

    # --------------------------------------------------------
    # CONNECTION
    # --------------------------------------------------------
    def _connect(self) -> None:
        params = pika.URLParameters(settings.rabbitmq_url)
        params.heartbeat = settings.rabbitmq_heartbeat
        params.blocked_connection_timeout = (
            settings.rabbitmq_connection_timeout
        )

        # Retry loop — RabbitMQ may still be starting.
        delay = 1.0
        max_attempts = 10
        last_err: Exception | None = None
        for attempt in range(1, max_attempts + 1):
            try:
                self._connection = pika.BlockingConnection(params)
                self._channel = self._connection.channel()
                log.info("rabbitmq_connected", attempt=attempt)
                return
            except pika.exceptions.AMQPConnectionError as e:
                last_err = e
                log.warning(
                    "rabbitmq_connect_failed",
                    attempt=attempt,
                    retry_in=delay,
                    error=str(e),
                )
                asyncio.run(asyncio.sleep(delay))
                delay = min(delay * 2, 30.0)

        raise RuntimeError(
            f"Could not connect to RabbitMQ after {max_attempts} attempts"
        ) from last_err

    def _declare_queue(self) -> None:
        assert self._channel is not None
        self._channel.exchange_declare(
            exchange=settings.rabbitmq_exchange,
            exchange_type="topic",
            durable=True,
        )
        self._channel.queue_declare(
            queue=settings.rabbitmq_queue,
            durable=True,
            arguments={
                "x-max-priority": 10,
                "x-dead-letter-exchange": f"{settings.rabbitmq_exchange}.dlx",
            },
        )
        self._channel.queue_bind(
            queue=settings.rabbitmq_queue,
            exchange=settings.rabbitmq_exchange,
            routing_key=settings.rabbitmq_routing_key,
        )
        # Also declare the dead-letter queue for failed jobs.
        dlq = f"{settings.rabbitmq_queue}.dlq"
        self._channel.exchange_declare(
            exchange=f"{settings.rabbitmq_exchange}.dlx",
            exchange_type="topic",
            durable=True,
        )
        self._channel.queue_declare(queue=dlq, durable=True)
        self._channel.queue_bind(
            queue=dlq,
            exchange=f"{settings.rabbitmq_exchange}.dlx",
            routing_key="#",
        )

    # --------------------------------------------------------
    # MESSAGE HANDLING
    # --------------------------------------------------------
    def _on_message(
        self,
        ch: BlockingChannel,
        method: Basic.Deliver,
        properties: BasicProperties,
        body: bytes,
    ) -> None:
        """Called by pika for every message. Must ACK or NACK."""
        headers = properties.headers or {}
        job_type_hint = headers.get("job-type", "unknown")

        log.info(
            "message_received",
            routing_key=method.routing_key,
            job_type_hint=job_type_hint,
            body_bytes=len(body),
        )

        # 1. Parse
        try:
            payload = json.loads(body)
        except json.JSONDecodeError as e:
            log.error("invalid_json", error=str(e))
            # Invalid JSON is never retryable — dead-letter it.
            ch.basic_nack(delivery_tag=method.delivery_tag, requeue=False)
            return

        job_type = payload.get("jobType") or payload.get("job_type")
        if not job_type or job_type not in _registry:
            log.error("unknown_job_type", job_type=job_type)
            ch.basic_nack(delivery_tag=method.delivery_tag, requeue=False)
            return

        # 2. Dispatch
        handler = _registry[job_type]
        try:
            handler(payload)
        except TransientError as e:
            log.warning(
                "transient_error",
                job_type=job_type,
                error=str(e),
            )
            # Requeue for retry — but check the retry count to avoid
            # infinite loops (RabbitMQ doesn't natively cap redeliveries).
            retries = int((headers.get("x-retries") or 0))
            if retries >= settings.job_max_retries:
                log.error(
                    "max_retries_exceeded",
                    job_type=job_type,
                    retries=retries,
                )
                ch.basic_nack(delivery_tag=method.delivery_tag, requeue=False)
                return
            # Republish with bumped retry count, then ACK the original.
            # This gives us a "retry N times" semantic.
            new_headers = dict(headers)
            new_headers["x-retries"] = retries + 1
            ch.basic_publish(
                exchange=settings.rabbitmq_exchange,
                routing_key=settings.rabbitmq_routing_key,
                body=body,
                properties=pika.BasicProperties(
                    headers=new_headers,
                    delivery_mode=2,  # persistent
                    content_type="application/json",
                ),
            )
            ch.basic_ack(delivery_tag=method.delivery_tag)
        except PermanentError as e:
            log.error(
                "permanent_error",
                job_type=job_type,
                error=str(e),
            )
            ch.basic_nack(delivery_tag=method.delivery_tag, requeue=False)
        except Exception as e:  # noqa: BLE001
            log.exception(
                "unexpected_handler_error",
                job_type=job_type,
                error=str(e),
            )
            # Treat unexpected errors as permanent (bug in handler) —
            # don't requeue and cause an infinite loop.
            ch.basic_nack(delivery_tag=method.delivery_tag, requeue=False)
        else:
            log.info("message_processed", job_type=job_type)
            ch.basic_ack(delivery_tag=method.delivery_tag)

    # --------------------------------------------------------
    # SIGNALS
    # --------------------------------------------------------
    def _signal_handler(self, signum: int, _frame: Any) -> None:
        log.info("signal_received", signal=signum)
        # Ask pika to stop; it will return from start_consuming()
        # after the current message completes.
        try:
            if self._channel and self._channel.is_open:
                self._channel.stop_consuming()
        except Exception:  # noqa: BLE001
            pass


# ============================================================
# EXCEPTIONS
# ============================================================
class TransientError(Exception):
    """Retryable failure (network blip, S3 timeout, etc.)."""


class PermanentError(Exception):
    """Non-retryable failure (bad input, unsupported format, etc.)."""