import "dotenv/config";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { prisma } from "@slideforge/db";
import pino from "pino";
import { generateThumbnails } from "../services/thumbnail-generator";

const logger = pino({ name: "backfill-thumbnails" });

const s3 = new S3Client({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || "minioadmin",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "minioadmin",
  },
  ...(process.env.S3_ENDPOINT_URL
    ? { endpoint: process.env.S3_ENDPOINT_URL, forcePathStyle: true }
    : {}),
});
const BUCKET = process.env.S3_BUCKET_NAME || "slideforge";

async function downloadPptx(key: string): Promise<Buffer> {
  const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const chunks: Buffer[] = [];
  const stream = res.Body as NodeJS.ReadableStream;
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}

async function main() {
  const all = await prisma.presentation.findMany({
    select: { id: true, projectId: true, jobId: true, s3Key: true, thumbnails: true, slideCount: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  const needs = all.filter((p) => {
    const t = p.thumbnails as unknown;
    return !Array.isArray(t) || t.length === 0;
  });

  logger.info({ total: all.length, needsBackfill: needs.length }, "Starting backfill");

  let ok = 0;
  let fail = 0;

  for (const p of needs) {
    try {
      logger.info({ id: p.id, s3Key: p.s3Key }, "Processing");
      const pptxBuffer = await downloadPptx(p.s3Key);
      const fakeJobId = p.jobId || `backfill-${p.id}`;
      const keys = await generateThumbnails(pptxBuffer, p.projectId, fakeJobId);
      if (keys.length === 0) {
        logger.warn({ id: p.id }, "Generator returned 0 thumbnails — skipping");
        fail++;
        continue;
      }
      await prisma.presentation.update({
        where: { id: p.id },
        data: { thumbnails: keys },
      });
      logger.info({ id: p.id, count: keys.length }, "Updated");
      ok++;
    } catch (err) {
      logger.error({ id: p.id, error: (err as Error).message }, "Failed");
      fail++;
    }
  }

  logger.info({ ok, fail }, "Backfill complete");
  await prisma.$disconnect();
}

main().catch((err) => {
  logger.error({ error: (err as Error).message }, "Fatal");
  process.exit(1);
});
