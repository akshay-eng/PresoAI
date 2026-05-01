"""Backfill: index every existing Presentation as a SourceFile in the Find feature.

For each presentations row:
  1. Create a corresponding source_files row owned by the project's user.
  2. Run SlideIndexer.index_pptx on it.

Idempotent — skip presentations that already have a source_file row keyed off the same s3Key+user.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

# Allow running from anywhere
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import psycopg
import structlog

from app.config import settings
from app.services.find_indexer import SlideIndexer

logger = structlog.get_logger("backfill")


def main() -> None:
    indexer = SlideIndexer()

    with psycopg.connect(settings.database_url) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    p.id          AS presentation_id,
                    p."s3Key"    AS s3_key,
                    p.title      AS title,
                    pr."userId" AS user_id,
                    p."createdAt" AS created_at
                FROM presentations p
                JOIN projects pr ON p."projectId" = pr.id
                ORDER BY p."createdAt" ASC
                """
            )
            presentations = cur.fetchall()

        logger.info("found_presentations", n=len(presentations))

        ok = 0
        skipped = 0
        failed = 0

        for (presentation_id, s3_key, title, user_id, created_at) in presentations:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id FROM source_files
                    WHERE "userId" = %s AND "s3Key" = %s
                    LIMIT 1
                    """,
                    (user_id, s3_key),
                )
                existing = cur.fetchone()

            if existing:
                source_file_id = existing[0]
                logger.info("skip_existing", presentation_id=presentation_id, source_file_id=source_file_id)
                # Still re-index in case slide_index is empty (idempotent insert in indexer)
            else:
                # Get file size from S3 for the row
                try:
                    head = indexer.s3.client.head_object(Bucket=indexer.s3.bucket, Key=s3_key)
                    size = int(head.get("ContentLength", 0))
                except Exception as exc:
                    logger.warning("head_failed", s3_key=s3_key, error=str(exc))
                    size = 0

                with conn.cursor() as cur:
                    cur.execute(
                        """
                        INSERT INTO source_files
                            (id, "userId", "fileName", "s3Key", "fileSize", status, "createdAt")
                        VALUES (gen_random_uuid()::text, %s, %s, %s, %s, 'pending', %s)
                        RETURNING id
                        """,
                        (user_id, (title or "Untitled.pptx") + ".pptx" if not (title or "").lower().endswith(".pptx") else (title or "Untitled.pptx"),
                         s3_key, size, created_at),
                    )
                    source_file_id = cur.fetchone()[0]
                conn.commit()

            # Mark indexing
            with conn.cursor() as cur:
                cur.execute('UPDATE source_files SET status=%s WHERE id=%s', ("indexing", source_file_id))
            conn.commit()

            try:
                result = indexer.index_pptx(
                    user_id=user_id,
                    source_file_id=source_file_id,
                    s3_key=s3_key,
                    thumbnail_prefix=f"find/{user_id}/{source_file_id}",
                )
                with conn.cursor() as cur:
                    cur.execute(
                        'UPDATE source_files SET status=%s, "slideCount"=%s, "indexedAt"=now(), error=NULL WHERE id=%s',
                        ("ready", result.get("slide_count"), source_file_id),
                    )
                conn.commit()
                logger.info("indexed", presentation_id=presentation_id, slides=result.get("slide_count"))
                ok += 1
            except Exception as exc:
                msg = str(exc)[:500]
                logger.error("failed", presentation_id=presentation_id, error=msg)
                with conn.cursor() as cur:
                    cur.execute('UPDATE source_files SET status=%s, error=%s WHERE id=%s', ("failed", msg, source_file_id))
                conn.commit()
                failed += 1

        logger.info("backfill_complete", ok=ok, skipped=skipped, failed=failed)


if __name__ == "__main__":
    os.makedirs(Path(__file__).parent, exist_ok=True)
    main()
