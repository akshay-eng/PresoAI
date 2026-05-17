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
const PDFTOPPM_PATH = process.env.PDFTOPPM_PATH || "pdftoppm";
const THUMBNAIL_WIDTH = 800;
const THUMBNAIL_QUALITY = 80;

/**
 * Render one PNG per slide of a PPTX and upload the intermediate PDF.
 *
 * Pipeline:
 *   PPTX --(soffice --convert-to pdf)--> PDF --(pdftoppm -png)--> slide-N.png
 * Each PNG is downscaled and uploaded to S3.
 * The PDF is also uploaded (for the "Download as PDF" feature).
 *
 * Returns both the thumbnail S3 keys and the PDF S3 key.
 */
export async function generateThumbnails(
  pptxBuffer: Buffer,
  projectId: string,
  jobId: string
): Promise<{ thumbnails: string[]; pdfS3Key: string | null }> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "slideforge-thumb-"));
  const pptxPath = path.join(tmpDir, "slides.pptx");
  const outDir = path.join(tmpDir, "output");

  try {
    await fs.mkdir(outDir, { recursive: true });
    await fs.writeFile(pptxPath, pptxBuffer);

    // ── Step 1: PPTX → PDF via LibreOffice ─────────────────────────────
    logger.info({ tmpDir }, "Starting LibreOffice PDF conversion");
    await execFileAsync(LIBREOFFICE_PATH, [
      "--headless",
      "--convert-to",
      "pdf",
      "--outdir",
      outDir,
      pptxPath,
    ], {
      timeout: 120000,
      env: { ...process.env, HOME: tmpDir },
    });

    // soffice names the output after the input basename — "slides.pptx" → "slides.pdf"
    const pdfPath = path.join(outDir, "slides.pdf");
    try {
      await fs.access(pdfPath);
    } catch {
      const all = await fs.readdir(outDir);
      logger.warn({ files: all }, "PDF not produced after LibreOffice conversion");
      return { thumbnails: [], pdfS3Key: null };
    }

    // ── Step 1b: Upload the PDF to S3 (used for "Download as PDF") ──────
    let pdfS3Key: string | null = null;
    try {
      const pdfBuffer = await fs.readFile(pdfPath);
      pdfS3Key = `generated/${projectId}/${jobId}/presentation.pdf`;
      await uploadToS3(pdfBuffer, pdfS3Key, "application/pdf");
      logger.info({ pdfS3Key }, "PDF uploaded to S3");
    } catch (err) {
      logger.warn({ err }, "Failed to upload PDF to S3 — thumbnails still proceed");
      pdfS3Key = null;
    }

    // ── Step 2: PDF → one PNG per page via pdftoppm ────────────────────
    // -r 96 = 96 DPI (renders to ~960px for a 10" slide; we downscale below)
    // -png  = output format
    // last arg is the output filename PREFIX — pdftoppm appends "-NN" per page
    await execFileAsync(PDFTOPPM_PATH, [
      "-r",
      "96",
      "-png",
      pdfPath,
      path.join(outDir, "slide"),
    ], {
      timeout: 120000,
      env: { ...process.env },
    });

    // pdftoppm zero-pads the page suffix based on total page count, so a
    // simple lexicographic sort produces the correct slide order.
    const files = await fs.readdir(outDir);
    const pngFiles = files
      .filter((f) => f.startsWith("slide-") && f.endsWith(".png"))
      .sort();

    if (pngFiles.length === 0) {
      logger.warn({ files }, "No per-slide PNGs produced by pdftoppm");
      return { thumbnails: [], pdfS3Key };
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
    return { thumbnails: thumbnailKeys, pdfS3Key };
  } finally {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // cleanup best effort
    }
  }
}
