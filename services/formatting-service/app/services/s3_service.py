"""
S3 adapter — uploads, downloads, presigned URLs.

Works with both AWS S3 and MinIO (via `S3_FORCE_PATH_STYLE=true`).
"""

from __future__ import annotations

import io
from typing import BinaryIO

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from app.config import settings
from app.utils.logger import get_logger
from app.utils.retry import retry_network


log = get_logger(__name__)


class S3Service:
    """Thin wrapper around boto3 S3 client."""

    def __init__(self) -> None:
        self._client = boto3.client(
            "s3",
            endpoint_url=settings.s3_endpoint,
            aws_access_key_id=settings.s3_access_key,
            aws_secret_access_key=settings.s3_secret_key,
            region_name=settings.s3_region,
            config=Config(
                signature_version="s3v4",
                s3={"addressing_style": "path" if settings.s3_force_path_style else "auto"},
                retries={"max_attempts": 3, "mode": "standard"},
                connect_timeout=10,
                read_timeout=60,
            ),
        )
        self._bucket = settings.s3_bucket

    # --------------------------------------------------------
    # Bucket
    # --------------------------------------------------------
    @retry_network()
    def ensure_bucket(self) -> None:
        """Create the bucket if it doesn't exist. No-op if it does."""
        try:
            self._client.head_bucket(Bucket=self._bucket)
            return
        except ClientError as e:
            code = e.response.get("Error", {}).get("Code", "")
            if code not in ("404", "NoSuchBucket"):
                raise
        try:
            self._client.create_bucket(Bucket=self._bucket)
            log.info("s3_bucket_created", bucket=self._bucket)
        except ClientError as e:
            # Already exists (race with another pod) — ignore
            if e.response.get("Error", {}).get("Code") != "BucketAlreadyOwnedByYou":
                raise

    @retry_network()
    def head_bucket(self) -> None:
        """Raise if the bucket is unreachable."""
        self._client.head_bucket(Bucket=self._bucket)

    # --------------------------------------------------------
    # Upload
    # --------------------------------------------------------
    @retry_network()
    def upload_file(
        self,
        key: str,
        data: bytes | BinaryIO,
        content_type: str,
    ) -> str:
        """
        Upload `data` to `key` and return the S3 URI.
        Sets Content-Type + public-read (overridden by bucket policy in prod).
        """
        body: BinaryIO
        if isinstance(data, (bytes, bytearray)):
            body = io.BytesIO(data)
        else:
            body = data

        self._client.upload_fileobj(
            Fileobj=body,
            Bucket=self._bucket,
            Key=key,
            ExtraArgs={
                "ContentType": content_type,
                "CacheControl": "public, max-age=31536000, immutable",
            },
        )
        uri = f"s3://{self._bucket}/{key}"
        log.info(
            "s3_uploaded",
            bucket=self._bucket,
            key=key,
            size_bytes=len(data) if isinstance(data, (bytes, bytearray)) else None,
            content_type=content_type,
        )
        return uri

    # --------------------------------------------------------
    # Download
    # --------------------------------------------------------
    @retry_network()
    def download_bytes(self, key: str) -> bytes:
        """Download an object's contents into memory."""
        buf = io.BytesIO()
        self._client.download_fileobj(
            Bucket=self._bucket, Key=key, Fileobj=buf
        )
        return buf.getvalue()

    # --------------------------------------------------------
    # Presigned URLs
    # --------------------------------------------------------
    def generate_presigned_download_url(
        self, key: str, expires_in: int = 3600
    ) -> str:
        """Time-limited GET URL for a file."""
        return self._client.generate_presigned_url(
            ClientMethod="get_object",
            Params={"Bucket": self._bucket, "Key": key},
            ExpiresIn=expires_in,
        )

    def generate_presigned_upload_url(
        self,
        key: str,
        content_type: str,
        expires_in: int = 900,
    ) -> dict[str, str]:
        """Time-limited PUT URL for client-side uploads (unused in v1)."""
        return self._client.generate_presigned_post(
            Bucket=self._bucket,
            Key=key,
            Fields={"Content-Type": content_type},
            Conditions=[{"Content-Type": content_type}],
            ExpiresIn=expires_in,
        )