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

// Lazy import S3 upload
async function uploadToS3(localPath: string, s3Key: string): Promise<void> {
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
    ContentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  }));
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
          outputPath,
          useGemini: data.useGemini || false,
        });

        // Upload to S3
        const s3Key = `generated/${data.projectId || "unknown"}/${data.jobId || Date.now()}/presentation.pptx`;
        await uploadToS3(outputPath, s3Key);

        console.log(`[pptx-agent-server] Uploaded to S3: ${s3Key}`);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ s3Key, outputPath, slideCount: data.numSlides }));

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
