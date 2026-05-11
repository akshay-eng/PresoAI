import { z } from "zod";
import { UserError, type Tool } from "fastmcp";
import type { PresoSession } from "../types.js";

/**
 * `upload_file` — two-step upload of a reference deck or image.
 *
 * Why we don't accept the file bytes directly through MCP: bytes inflate
 * the MCP message size and force base64-encoding through three protocol
 * layers (agent → MCP transport → REST). Instead we mint a presigned PUT
 * URL the agent's HTTP client can use directly. Same pattern Anthropic uses
 * for its own file-input tools.
 *
 * The flow:
 *   1. Agent calls `upload_file({ fileName, contentType, purpose })`
 *   2. We return { uploadUrl, s3Key, expiresIn }
 *   3. Agent does its own HTTP PUT to uploadUrl with the bytes
 *   4. Agent passes s3Key as `referenceFileKeys` in `create_deck`
 */

const inputSchema = z.object({
  fileName: z.string().min(1).max(500)
    .describe("Filename including extension (used for the s3 key + Content-Disposition)."),
  contentType: z.string().min(1).max(200)
    .describe(
      "MIME type. For .pptx use " +
      "'application/vnd.openxmlformats-officedocument.presentationml.presentation'. " +
      "For images: 'image/png', 'image/jpeg', 'image/webp'."
    ),
  purpose: z.enum(["reference", "chat-image", "template"]).optional()
    .describe(
      "What the file will be used for. " +
      "'reference' = past deck or research doc to draw from. " +
      "'chat-image' = vision input for layout cloning. " +
      "'template' = brand .pptx to lock styling. " +
      "Default: reference."
    ),
});

export const uploadFileTool: Tool<PresoSession, typeof inputSchema> = {
  name: "upload_file",
  description:
    "Get a presigned URL to upload a reference deck (.pptx/.pdf/.docx) or " +
    "image. After uploading, pass the returned `s3Key` as `referenceFileKeys` " +
    "or `chatImageKeys` in `create_deck`. The presigned URL is valid for 10 minutes.",
  parameters: inputSchema,
  annotations: { idempotentHint: false, openWorldHint: true },
  execute: async (args, { session }) => {
    const sess = session as unknown as PresoSession;
    if (!sess?.client) throw new UserError("Session is missing");
    const result = await sess.client.presignFileUpload({
      fileName: args.fileName,
      contentType: args.contentType,
      purpose: args.purpose,
    });
    return JSON.stringify(
      {
        ...result,
        instructions:
          `PUT the file bytes to "uploadUrl" within ${result.expiresIn} seconds with ` +
          `header 'Content-Type: ${args.contentType}'. Then pass "s3Key" to create_deck's ` +
          `referenceFileKeys (for documents) or chatImageKeys (for images).`,
      },
      null,
      2,
    );
  },
};
