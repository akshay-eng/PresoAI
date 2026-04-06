from __future__ import annotations

import tempfile
from pathlib import Path

import boto3
import structlog

from app.config import settings

logger = structlog.get_logger()


class S3Service:
    def __init__(self) -> None:
        kwargs: dict = {
            "aws_access_key_id": settings.aws_access_key_id,
            "aws_secret_access_key": settings.aws_secret_access_key,
            "region_name": settings.aws_region,
        }
        if settings.s3_endpoint_url:
            kwargs["endpoint_url"] = settings.s3_endpoint_url
        self.client = boto3.client("s3", **kwargs)
        self.bucket = settings.s3_bucket_name

    def download_to_temp(self, s3_key: str, suffix: str | None = None) -> Path:
        if suffix is None:
            suffix = Path(s3_key).suffix
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
        logger.info("downloading_from_s3", key=s3_key, dest=tmp.name)
        self.client.download_file(self.bucket, s3_key, tmp.name)
        tmp.close()
        return Path(tmp.name)

    def upload_file(self, local_path: str | Path, s3_key: str, content_type: str = "application/octet-stream") -> str:
        logger.info("uploading_to_s3", key=s3_key, source=str(local_path))
        self.client.upload_file(
            str(local_path),
            self.bucket,
            s3_key,
            ExtraArgs={"ContentType": content_type},
        )
        return s3_key

    def upload_bytes(self, data: bytes, s3_key: str, content_type: str = "application/octet-stream") -> str:
        logger.info("uploading_bytes_to_s3", key=s3_key, size=len(data))
        self.client.put_object(
            Bucket=self.bucket,
            Key=s3_key,
            Body=data,
            ContentType=content_type,
        )
        return s3_key

    def generate_presigned_url(self, s3_key: str, expires_in: int = 3600) -> str:
        return self.client.generate_presigned_url(
            "get_object",
            Params={"Bucket": self.bucket, "Key": s3_key},
            ExpiresIn=expires_in,
        )
