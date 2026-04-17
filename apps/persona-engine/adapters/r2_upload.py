"""OPTIONAL utility — Upload session screenshots to Cloudflare R2.

**This is not called by main.py** and is intentionally decoupled from the
engine's request flow. Upload responsibility belongs to the embedding
server (41rpm apps/api via its existing services/r2.ts). This file is
kept as a reference Python implementation for callers who want to upload
from the engine side instead.

persona_agent's browser_runner saves screenshots under
``workspace/sessions/<session_id>/screenshots/``. The engine's JobResult
returns ``screenshot_paths`` (absolute filesystem paths) — the consumer
picks them up.
"""
from __future__ import annotations

import logging
import os
from pathlib import Path

logger = logging.getLogger(__name__)


def _r2_client():
    """Lazy boto3 client — only imported when upload is actually called."""
    import boto3

    endpoint = f"https://{os.environ['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com"
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        region_name="auto",
    )


def upload_session_screenshots(session_id: str, workspace_root: Path) -> list[str]:
    """Upload every screenshot under workspace/sessions/<id>/screenshots/ to R2.
    Returns public URLs (if R2_PUBLIC_URL is set) or s3:// keys."""
    session_dir = workspace_root / "sessions" / session_id / "screenshots"
    if not session_dir.exists():
        logger.info("no screenshots for session %s", session_id)
        return []

    bucket = os.environ.get("R2_BUCKET", "41rpm-screenshots")
    public_prefix = os.environ.get("R2_PUBLIC_URL", "").rstrip("/")
    client = _r2_client()

    urls: list[str] = []
    for f in sorted(session_dir.glob("*.png")):
        key = f"sessions/{session_id}/{f.name}"
        try:
            client.put_object(
                Bucket=bucket, Key=key,
                Body=f.read_bytes(), ContentType="image/png",
            )
        except Exception:
            logger.exception("R2 upload failed for %s", f)
            continue
        url = f"{public_prefix}/{key}" if public_prefix else f"s3://{bucket}/{key}"
        urls.append(url)
    return urls
