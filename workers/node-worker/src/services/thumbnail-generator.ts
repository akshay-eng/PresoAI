import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import os from "os";
import sharp from "sharp";
import pino from "pino";
import { uploadToS3 } from "./s3-client";

const execFileAsync = promisify(execFile);
const logger = pino({ name: "thumbnail-generator" });

const LIBREOFFICE_PATH = process.env.LIBREOFFICE_PATH || "/usr/bin/libreoffice";
const THUMBNAIL_WIDTH = 800;
const THUMBNAIL_QUALITY = 80;

export async function generateThumbnails(
  pptxBuffer: Buffer,
  projectId: string,
  jobId: string
): Promise<string[]> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "slideforge-thumb-"));
  const pptxPath = path.join(tmpDir, "slides.pptx");
  const outDir = path.join(tmpDir, "output");

  try {
    await fs.mkdir(outDir, { recursive: true });
    await fs.writeFile(pptxPath, pptxBuffer);

    logger.info({ tmpDir }, "Starting LibreOffice conversion");

    await execFileAsync(LIBREOFFICE_PATH, [
      "--headless",
      "--convert-to",
      "png",
      "--outdir",
      outDir,
      pptxPath,
    ], {
      timeout: 120000,
      env: {
        ...process.env,
        HOME: tmpDir,
      },
    });

    const files = await fs.readdir(outDir);
    const pngFiles = files
      .filter((f) => f.endsWith(".png"))
      .sort((a, b) => {
        const numA = parseInt(a.match(/\d+/)?.[0] || "0", 10);
        const numB = parseInt(b.match(/\d+/)?.[0] || "0", 10);
        return numA - numB;
      });

    if (pngFiles.length === 0) {
      // LibreOffice might produce a single image for single-page or produce differently named files
      // Try to find any png files in outDir
      const allFiles = await fs.readdir(outDir);
      logger.warn({ files: allFiles }, "No PNG files found after conversion");
      return [];
    }

    const thumbnailKeys: string[] = [];

    for (let i = 0; i < pngFiles.length; i++) {
      const filePath = path.join(outDir, pngFiles[i]!);
      const rawBuffer = await fs.readFile(filePath);

      const optimized = await sharp(rawBuffer)
        .resize({ width: THUMBNAIL_WIDTH })
        .png({ quality: THUMBNAIL_QUALITY })
        .toBuffer();

      const s3Key = `generated/${projectId}/${jobId}/thumb-${i + 1}.png`;
      await uploadToS3(optimized, s3Key, "image/png");
      thumbnailKeys.push(s3Key);
    }

    logger.info({ count: thumbnailKeys.length }, "Thumbnails generated and uploaded");
    return thumbnailKeys;
  } finally {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // cleanup best effort
    }
  }
}
