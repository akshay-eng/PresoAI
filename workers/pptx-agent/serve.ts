/**
 * PPTX Agent HTTP Server — called by the Python agent worker.
 *
 * POST /generate
 * Body: { prompt, numSlides, audience, outline, researchSummary, styleGuide, knowledgeGraphContext, projectId, jobId }
 * Response: { s3Key, outputPath }
 */

import http from "http";
import { generatePptx } from "./generate";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

// Lazy import S3 upload
async function uploadToS3(
  localPath: string,
  s3Key: string,
  contentType: string = "application/vnd.openxmlformats-officedocument.presentationml.presentation",
): Promise<void> {
  const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");

  const client = new S3Client({
    region: process.env.AWS_REGION || "us-east-1",
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || "minioadmin",
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "minioadmin",
    },
    ...(process.env.S3_ENDPOINT_URL ? { endpoint: process.env.S3_ENDPOINT_URL, forcePathStyle: true } : {}),
  });

  const buffer = fs.readFileSync(localPath);
  await client.send(new PutObjectCommand({
    Bucket: process.env.S3_BUCKET_NAME || "slideforge",
    Key: s3Key,
    Body: buffer,
    ContentType: contentType,
  }));
}

/**
 * Convert a .pptx to per-slide PNG thumbnails via LibreOffice + pdftoppm.
 * Uploads each PNG to S3 and returns the keys. Best-effort — returns []
 * on failure so a thumbnail error never blocks the generation response.
 */
async function generateAndUploadThumbnails(
  pptxPath: string,
  projectId: string,
  jobId: string,
): Promise<string[]> {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "preso-thumbs-"));
  try {
    // Step 1 — soffice → PDF (much more reliable than direct PNG export).
    await execFileAsync(
      "soffice",
      ["--headless", "--convert-to", "pdf", "--outdir", workDir, pptxPath],
      { timeout: 60_000 },
    );
    const pdfName = path.basename(pptxPath, ".pptx") + ".pdf";
    const pdfPath = path.join(workDir, pdfName);
    if (!fs.existsSync(pdfPath)) {
      console.warn(`[pptx-agent] thumbnail: PDF not produced at ${pdfPath}`);
      return [];
    }

    // Step 2 — pdftoppm → one PNG per page. Naming: slide-1.png, slide-2.png …
    await execFileAsync(
      "pdftoppm",
      ["-r", "96", "-png", pdfPath, path.join(workDir, "slide")],
      { timeout: 60_000 },
    );

    // Step 3 — upload each PNG. pdftoppm zero-pads names based on page count.
    const pngs = fs
      .readdirSync(workDir)
      .filter((f) => f.startsWith("slide-") && f.endsWith(".png"))
      .sort(); // natural-order is OK because pdftoppm zero-pads

    const keys: string[] = [];
    for (let i = 0; i < pngs.length; i++) {
      const localPng = path.join(workDir, pngs[i]!);
      const key = `generated/${projectId}/${jobId}/thumbs/slide-${i + 1}.png`;
      await uploadToS3(localPng, key, "image/png");
      keys.push(key);
    }
    console.log(`[pptx-agent] uploaded ${keys.length} thumbnails`);
    return keys;
  } catch (e) {
    console.warn(
      `[pptx-agent] thumbnail generation failed:`,
      (e as Error).message?.substring(0, 300),
    );
    return [];
  } finally {
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch {}
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/generate") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      try {
        const data = JSON.parse(body);
        const outputPath = `/tmp/slideforge-${data.jobId || Date.now()}.pptx`;

        console.log(`[pptx-agent-server] Generating ${data.numSlides} slides for job ${data.jobId}`);

        await generatePptx({
          prompt: data.prompt || "",
          numSlides: data.numSlides || 5,
          audience: data.audience || "technical",
          outline: data.outline || [],
          researchSummary: data.researchSummary || "",
          styleGuide: data.styleGuide || "",
          knowledgeGraphContext: data.knowledgeGraphContext || "",
          projectMemoryContext: data.projectMemoryContext || "",
          outputPath,
          useGemini: data.useGemini || false,
        });

        // Upload to S3
        const s3Key = `generated/${data.projectId || "unknown"}/${data.jobId || Date.now()}/presentation.pptx`;
        await uploadToS3(outputPath, s3Key);
        console.log(`[pptx-agent-server] Uploaded to S3: ${s3Key}`);

        // Render + upload per-slide thumbnails BEFORE responding so the
        // python-agent can persist their keys on the Presentation row.
        // Best-effort: a failure here returns [] and never blocks the deck.
        const thumbnailKeys = await generateAndUploadThumbnails(
          outputPath,
          data.projectId || "unknown",
          data.jobId || String(Date.now()),
        );

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            s3Key,
            outputPath,
            slideCount: thumbnailKeys.length || data.numSlides,
            thumbnailKeys,
          }),
        );

        // Cleanup
        try { fs.unlinkSync(outputPath); } catch {}
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[pptx-agent-server] Error:`, msg);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: msg }));
      }
    });
  } else if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
  } else {
    res.writeHead(404);
    res.end("Not found");
  }
});

const PORT = parseInt(process.env.PPTX_AGENT_PORT || "8100", 10);
server.listen(PORT, () => {
  console.log(`[pptx-agent-server] Listening on port ${PORT}`);
});
