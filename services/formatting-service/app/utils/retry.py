"""
Retry helpers — tenacity wrappers for transient external failures.

Usage:
    from app.utils.retry import retry_network

    @retry_network()
    def flaky_call():
        ...
"""

from __future__ import annotations

from typing import Any, Callable

import httpx
from botocore.exceptions import (
    ClientError,
    EndpointConnectionError,
    ConnectionClosedError,
)
from tenacity import (
    retry,
    retry_if_exception,
    stop_after_attempt,
    wait_exponential_jitter,
    before_sleep_log,
)

from app.utils.logger import get_logger


log = get_logger(__name__)


# ------------------------------------------------------------
# Predicates
# ------------------------------------------------------------
def _is_transient(err: BaseException) -> bool:
    """True if `err` represents a transient failure worth retrying."""
    # httpx transport errors + timeouts
    if isinstance(err, (httpx.TimeoutException, httpx.NetworkError)):
        return True

    # boto3 connection issues
    if isinstance(err, (EndpointConnectionError, ConnectionClosedError)):
        return True

    # boto3 ClientError — retry on 5xx + throttling
    if isinstance(err, ClientError):
        code = err.response.get("Error", {}).get("Code", "")
        if code in ("RequestTimeout", "SlowDown", "ServiceUnavailable"):
            return True
        status = err.response.get("ResponseMetadata", {}).get("HTTPStatusCode", 0)
        if 500 <= status < 600:
            return True

    return False


# ------------------------------------------------------------
# Decorators
# ------------------------------------------------------------
def retry_network(
    max_attempts: int = 3,
    min_wait_s: float = 0.5,
    max_wait_s: float = 8.0,
) -> Callable[..., Any]:
    """
    Retry decorator for network calls (S3, HTTP).

    - Exponential backoff with jitter (0.5s → 8s)
    - Retries on: timeouts, connection errors, 5xx, throttling
    - Non-retryable errors propagate immediately
    """

    def _decorator(fn: Callable[..., Any]) -> Callable[..., Any]:
        return retry(
            retry=retry_if_exception(_is_transient),
            stop=stop_after_attempt(max_attempts),
            wait=wait_exponential_jitter(
                initial=min_wait_s, max=max_wait_s
            ),
            before_sleep=before_sleep_log(log, "warning"),  # type: ignore[arg-type]
            reraise=True,
        )(fn)

    return _decorator