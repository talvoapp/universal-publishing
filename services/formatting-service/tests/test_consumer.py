"""
Tests for the RabbitMQ consumer — handler dispatch + error routing.

We test the dispatch logic directly (no real RabbitMQ needed).
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from app import consumer
from app.consumer import PermanentError, TransientError


@pytest.fixture(autouse=True)
def clear_registry(reset_handlers):
    """Ensure each test starts with an empty handler registry."""
    yield


# ============================================================
# REGISTRY
# ============================================================
class TestRegistry:
    def test_registers_handler(self):
        def handler(payload):
            pass
        consumer.register_handler("test.job", handler)
        assert "test.job" in consumer._registry

    def test_overwrites_existing(self):
        consumer.register_handler("test.job", lambda _: None)
        second = lambda _: None
        consumer.register_handler("test.job", second)
        assert consumer._registry["test.job"] is second


# ============================================================
# DISPATCH
# ============================================================
def _make_mock_channel():
    ch = MagicMock()
    ch.basic_ack = MagicMock()
    ch.basic_nack = MagicMock()
    ch.basic_publish = MagicMock()
    return ch


def _make_method(delivery_tag=1, routing_key="formatting.job"):
    method = MagicMock()
    method.delivery_tag = delivery_tag
    method.routing_key = routing_key
    return method


def _make_props(headers=None, delivery_mode=2):
    props = MagicMock()
    props.headers = headers or {}
    props.delivery_mode = delivery_mode
    return props


class TestDispatch:
    def test_happy_path_acks(self):
        called = []
        consumer.register_handler("test.ok", lambda p: called.append(p))
        ch = _make_mock_channel()
        inst = consumer.FormattingConsumer.__new__(consumer.FormattingConsumer)

        body = b'{"jobType": "test.ok", "value": 42}'
        inst._on_message(ch, _make_method(), _make_props(), body)

        assert len(called) == 1
        assert called[0]["value"] == 42
        ch.basic_ack.assert_called_once_with(delivery_tag=1)
        ch.basic_nack.assert_not_called()

    def test_invalid_json_nacks_permanent(self):
        ch = _make_mock_channel()
        inst = consumer.FormattingConsumer.__new__(consumer.FormattingConsumer)

        inst._on_message(ch, _make_method(), _make_props(), b'not-json')
        ch.basic_nack.assert_called_once_with(delivery_tag=1, requeue=False)
        ch.basic_ack.assert_not_called()

    def test_unknown_job_type_nacks_permanent(self):
        ch = _make_mock_channel()
        inst = consumer.FormattingConsumer.__new__(consumer.FormattingConsumer)

        body = b'{"jobType": "unknown.job"}'
        inst._on_message(ch, _make_method(), _make_props(), body)
        ch.basic_nack.assert_called_once_with(delivery_tag=1, requeue=False)

    def test_transient_error_republishes(self):
        def handler(_):
            raise TransientError("temporary glitch")
        consumer.register_handler("test.flaky", handler)

        ch = _make_mock_channel()
        inst = consumer.FormattingConsumer.__new__(consumer.FormattingConsumer)

        body = b'{"jobType": "test.flaky"}'
        inst._on_message(ch, _make_method(), _make_props(headers={}), body)

        # Should republish + ack
        ch.basic_publish.assert_called_once()
        ch.basic_ack.assert_called_once_with(delivery_tag=1)
        ch.basic_nack.assert_not_called()

    def test_transient_error_max_retries_nacks(self):
        def handler(_):
            raise TransientError("still broken")
        consumer.register_handler("test.flaky", handler)

        ch = _make_mock_channel()
        inst = consumer.FormattingConsumer.__new__(consumer.FormattingConsumer)

        body = b'{"jobType": "test.flaky"}'
        # Already at max retries (default 3) — 3 in headers means 4th attempt
        inst._on_message(ch, _make_method(), _make_props(headers={"x-retries": 3}), body)

        ch.basic_nack.assert_called_once_with(delivery_tag=1, requeue=False)
        ch.basic_publish.assert_not_called()

    def test_permanent_error_nacks(self):
        def handler(_):
            raise PermanentError("won't work")
        consumer.register_handler("test.bad", handler)

        ch = _make_mock_channel()
        inst = consumer.FormattingConsumer.__new__(consumer.FormattingConsumer)

        body = b'{"jobType": "test.bad"}'
        inst._on_message(ch, _make_method(), _make_props(), body)

        ch.basic_nack.assert_called_once_with(delivery_tag=1, requeue=False)
        ch.basic_publish.assert_not_called()

    def test_unexpected_error_nacks_permanent(self):
        def handler(_):
            raise RuntimeError("bug in handler")
        consumer.register_handler("test.bug", handler)

        ch = _make_mock_channel()
        inst = consumer.FormattingConsumer.__new__(consumer.FormattingConsumer)

        body = b'{"jobType": "test.bug"}'
        inst._on_message(ch, _make_method(), _make_props(), body)

        # Unexpected = treat as permanent (no infinite retry)
        ch.basic_nack.assert_called_once_with(delivery_tag=1, requeue=False)
        ch.basic_publish.assert_not_called()