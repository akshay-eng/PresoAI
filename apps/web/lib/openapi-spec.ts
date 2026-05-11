/**
 * OpenAPI 3.1 specification for the Preso public REST API (v1).
 *
 * This is the source of truth for:
 *   - The interactive docs viewer at /docs/api (rendered by Scalar)
 *   - The downloadable spec at /api/openapi.json (Postman / Insomnia / SDK gen)
 *
 * Keep this file in sync with the actual route handlers. When you add or
 * change an endpoint under app/api/v1, update the corresponding entry below.
 */

export const OPENAPI_VERSION = "3.1.0";

export function buildOpenApiSpec(baseUrl: string) {
  return {
    openapi: OPENAPI_VERSION,
    info: {
      title: "Preso REST API",
      version: "1.0.0",
      summary:
        "Generate enterprise-quality PowerPoint decks programmatically. " +
        "Async job model, surgical edits, brand-style support, and an MCP server on top.",
      description:
        "The Preso API lets agents and backends generate, edit, and download " +
        "presentation decks from a natural-language prompt. Auth is a Bearer " +
        "token minted from Settings → Developer (`psf_…`). Generation is async: " +
        "POST /v1/decks returns a `jobId` that you poll via GET /v1/jobs/{id} " +
        "or stream via /v1/jobs/{id}/stream until it's `succeeded`.\n\n" +
        "**Provider whitelist.** Only `openai`, `anthropic`, `google`, and " +
        "`mistral` are supported. The user's stored provider key is used " +
        "automatically; you can override per-request via the `model` field.\n\n" +
        "**Idempotency.** POST endpoints accept an `Idempotency-Key` header. " +
        "Same key + same API key = same response (cached for 24 hours). " +
        "Safe to retry on timeouts.",
      contact: { name: "Preso Support", url: `${baseUrl}/docs` },
    },
    servers: [{ url: baseUrl, description: "Current host" }],
    tags: [
      { name: "Decks", description: "Create, edit, retrieve, and download presentation decks." },
      { name: "Jobs", description: "Track the status of async generation/edit jobs." },
      { name: "Files", description: "Upload reference decks or images for use in /v1/decks." },
      { name: "Catalog", description: "List style profiles and available LLM configs." },
    ],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "psf_…",
          description:
            "Mint a key in Settings → Developer. Pass it as `Authorization: Bearer psf_…`. " +
            "Keys can be revoked at any time from the same screen.",
        },
      },
      schemas: {
        Error: {
          type: "object",
          required: ["error"],
          properties: {
            error: {
              type: "object",
              required: ["code", "message"],
              properties: {
                code: { type: "string", example: "validation_failed" },
                message: { type: "string", example: "Invalid request body" },
                details: { type: "object", additionalProperties: true, nullable: true },
              },
            },
          },
        },
        ModelOverride: {
          type: "object",
          description: "Optional per-request override of the LLM. If omitted, the user's stored provider key is used.",
          required: ["provider", "model", "apiKey"],
          properties: {
            provider: { type: "string", enum: ["openai", "anthropic", "google", "mistral"] },
            model: { type: "string", example: "gemini-2.5-pro", description: "Provider-specific model identifier." },
            apiKey: { type: "string", description: "API key for the chosen provider. Used once for this request and never stored.", writeOnly: true },
          },
        },
        CreateDeckRequest: {
          type: "object",
          required: ["prompt", "numSlides"],
          properties: {
            prompt: { type: "string", minLength: 1, maxLength: 10000, description: "Natural-language description of the deck (topic, audience, asks)." },
            numSlides: { type: "integer", minimum: 1, maximum: 15, description: "How many slides to generate." },
            audienceType: { type: "string", enum: ["executive", "technical", "general", "marketing"], default: "general" },
            engine: {
              type: "string",
              enum: ["preso-pro", "node-worker", "claude-code", "claude-gemini"],
              default: "node-worker",
              description: "Generation engine. `preso-pro` uses the Python composer with native SmartArt; `node-worker` (Preso Elite) uses pptxgenjs with the strongest prompt; `claude-code` runs Claude Code CLI; `claude-gemini` is Claude Code via Gemini.",
            },
            creativeMode: { type: "boolean", default: false, description: "Pushes the agent to use unconventional layouts (pyramids, hub-and-spoke, comparison diptychs)." },
            useDiagramImages: { type: "boolean", default: false, description: "Render complex diagrams (sequence, architecture, ER) as images via Kroki." },
            styleProfileId: { type: "string", description: "ID of a brand-style profile (yours or one of the platform globals: IBM, ICICI, Wipro). See GET /v1/style-profiles." },
            referenceFileKeys: { type: "array", items: { type: "string" }, maxItems: 10, description: "S3 keys returned by POST /v1/files for reference decks/PDFs." },
            chatImageKeys: { type: "array", items: { type: "string" }, maxItems: 10, description: "S3 keys for vision-input images (e.g. an image to clone as a slide)." },
            model: { $ref: "#/components/schemas/ModelOverride" },
            name: { type: "string", maxLength: 255, description: "Optional project name. Auto-derived from the prompt if omitted." },
          },
        },
        CreateDeckResponse: {
          type: "object",
          required: ["jobId", "deckId", "status", "statusUrl", "streamUrl"],
          properties: {
            jobId: { type: "string", example: "cmoxg2jil0005145i0bm82tqq" },
            deckId: { type: "string", example: "cmoxfvztp000875pss1bsrr47" },
            status: { type: "string", enum: ["queued", "processing", "succeeded", "failed"], example: "queued" },
            statusUrl: { type: "string", format: "uri", example: "https://preso.example/api/v1/jobs/{jobId}" },
            streamUrl: { type: "string", format: "uri", example: "https://preso.example/api/v1/jobs/{jobId}/stream" },
          },
        },
        EditDeckRequest: {
          type: "object",
          required: ["instruction"],
          properties: {
            instruction: { type: "string", minLength: 1, maxLength: 4000, example: "Change slide 3's bar chart to a line chart and tighten the cover subtitle." },
            targetSlides: { type: "array", items: { type: "integer", minimum: 1 }, description: "Optional hint about which slide numbers to edit." },
            model: { $ref: "#/components/schemas/ModelOverride" },
          },
        },
        Job: {
          type: "object",
          required: ["jobId", "deckId", "status", "progress", "createdAt"],
          properties: {
            jobId: { type: "string" },
            deckId: { type: "string" },
            status: { type: "string", enum: ["queued", "processing", "succeeded", "failed"] },
            phase: { type: "string", nullable: true, description: "Free-form phase label like 'researching', 'writing_slides', 'building_pptx'." },
            progress: { type: "number", minimum: 0, maximum: 1 },
            message: { type: "string", nullable: true },
            presentationId: { type: "string", nullable: true, description: "Set once the job has succeeded." },
            downloadUrl: { type: "string", format: "uri", nullable: true, description: "Pre-signed URL valid for 1 hour. Set once the job has succeeded." },
            slideCount: { type: "integer", nullable: true },
            createdAt: { type: "string", format: "date-time" },
            completedAt: { type: "string", format: "date-time", nullable: true },
            error: { type: "object", nullable: true, properties: { code: { type: "string" }, message: { type: "string" } } },
          },
        },
        Deck: {
          type: "object",
          properties: {
            deckId: { type: "string" },
            name: { type: "string" },
            prompt: { type: "string" },
            audienceType: { type: "string" },
            numSlides: { type: "integer" },
            styleProfileId: { type: "string", nullable: true },
            createdAt: { type: "string", format: "date-time" },
            presentations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  version: { type: "integer" },
                  slideCount: { type: "integer" },
                  title: { type: "string" },
                  createdAt: { type: "string", format: "date-time" },
                },
              },
            },
          },
        },
        DownloadResponse: {
          type: "object",
          required: ["presentationId", "version", "slideCount", "downloadUrl", "expiresIn"],
          properties: {
            presentationId: { type: "string" },
            version: { type: "integer" },
            slideCount: { type: "integer" },
            downloadUrl: { type: "string", format: "uri" },
            expiresIn: { type: "integer", description: "Seconds until the presigned URL expires." },
          },
        },
        FilePresignRequest: {
          type: "object",
          required: ["fileName", "contentType"],
          properties: {
            fileName: { type: "string", maxLength: 500 },
            contentType: { type: "string", example: "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
            purpose: { type: "string", enum: ["reference", "chat-image", "template"], default: "reference" },
            fileSize: { type: "integer", description: "Optional, for client-side validation only.", maximum: 100 * 1024 * 1024 },
          },
        },
        FilePresignResponse: {
          type: "object",
          required: ["uploadUrl", "s3Key", "expiresIn"],
          properties: {
            uploadUrl: { type: "string", format: "uri", description: "PUT the file bytes to this URL within `expiresIn` seconds." },
            s3Key: { type: "string", description: "Pass this to /v1/decks `referenceFileKeys` or `chatImageKeys`." },
            expiresIn: { type: "integer" },
          },
        },
        FileUploadResponse: {
          type: "object",
          required: ["s3Key", "fileName", "fileSize", "fileType", "purpose"],
          properties: {
            s3Key: { type: "string" },
            fileName: { type: "string" },
            fileSize: { type: "integer" },
            fileType: { type: "string" },
            purpose: { type: "string", enum: ["reference", "chat-image", "template"] },
          },
        },
        StyleProfile: {
          type: "object",
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            description: { type: "string", nullable: true },
            isGlobal: { type: "boolean", description: "True for platform-provided defaults (IBM, ICICI, Wipro)." },
            createdAt: { type: "string", format: "date-time" },
          },
        },
        LlmConfig: {
          type: "object",
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            provider: { type: "string", enum: ["openai", "anthropic", "google", "mistral"] },
            model: { type: "string" },
            isDefault: { type: "boolean" },
            userHasProviderKey: { type: "boolean", description: "True when the user has stored a provider key for this provider — meaning you can omit the `model.apiKey` body field in /v1/decks calls." },
          },
        },
      },
      responses: {
        Unauthorized: {
          description: "Missing or invalid bearer token.",
          content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
        },
        Forbidden: {
          description: "Key revoked, expired, or account has no entitlement (no coupon and no provider key).",
          content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
        },
        RateLimited: {
          description: "Too many requests for this API key.",
          headers: {
            "Retry-After": { schema: { type: "integer" }, description: "Seconds to wait before retrying." },
            "X-RateLimit-Limit-Minute": { schema: { type: "integer" } },
            "X-RateLimit-Remaining-Minute": { schema: { type: "integer" } },
            "X-RateLimit-Limit-Hour": { schema: { type: "integer" } },
            "X-RateLimit-Remaining-Hour": { schema: { type: "integer" } },
          },
          content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
        },
        ValidationFailed: {
          description: "Body or query parameters didn't validate.",
          content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
        },
        NotFound: {
          description: "Resource not visible to this account.",
          content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
        },
      },
      parameters: {
        IdempotencyKey: {
          name: "Idempotency-Key",
          in: "header",
          required: false,
          schema: { type: "string", maxLength: 200 },
          description:
            "Client-supplied retry token (UUID recommended). Same key + same Bearer = the original response replayed for 24h. Safe to retry on connection timeouts.",
        },
      },
    },
    security: [{ BearerAuth: [] }],
    paths: {
      "/api/v1/decks": {
        post: {
          tags: ["Decks"],
          summary: "Create a deck",
          description: "Kick off async generation. Returns immediately with a `jobId`; poll `/v1/jobs/{id}` or stream `/v1/jobs/{id}/stream`.",
          operationId: "createDeck",
          parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/CreateDeckRequest" } } },
          },
          responses: {
            "202": {
              description: "Accepted. Generation job dispatched.",
              content: { "application/json": { schema: { $ref: "#/components/schemas/CreateDeckResponse" } } },
            },
            "400": { $ref: "#/components/responses/ValidationFailed" },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "403": { $ref: "#/components/responses/Forbidden" },
            "429": { $ref: "#/components/responses/RateLimited" },
          },
        },
      },
      "/api/v1/decks/{id}": {
        get: {
          tags: ["Decks"],
          summary: "Get deck metadata",
          operationId: "getDeck",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/Deck" } } } },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
      },
      "/api/v1/decks/{id}/edit": {
        post: {
          tags: ["Decks"],
          summary: "Surgically edit an existing deck",
          description: "Patches only the slides affected by the instruction (Claude-Code-style narrow edits). Same async contract as create.",
          operationId: "editDeck",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { $ref: "#/components/parameters/IdempotencyKey" },
          ],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/EditDeckRequest" } } },
          },
          responses: {
            "202": {
              description: "Accepted. Edit job dispatched.",
              content: { "application/json": { schema: { $ref: "#/components/schemas/CreateDeckResponse" } } },
            },
            "400": { $ref: "#/components/responses/ValidationFailed" },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "403": { $ref: "#/components/responses/Forbidden" },
            "404": { $ref: "#/components/responses/NotFound" },
            "422": { description: "Deck has no editable slide source (older deck or non-Preso-Elite engine).", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
            "429": { $ref: "#/components/responses/RateLimited" },
          },
        },
      },
      "/api/v1/decks/{id}/download": {
        get: {
          tags: ["Decks"],
          summary: "Get a presigned download URL",
          operationId: "downloadDeck",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "version", in: "query", required: false, schema: { type: "integer", minimum: 1 }, description: "Specific presentation version. Defaults to the latest." },
          ],
          responses: {
            "200": { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/DownloadResponse" } } } },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
      },
      "/api/v1/jobs/{id}": {
        get: {
          tags: ["Jobs"],
          summary: "Poll a job's status",
          operationId: "getJob",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/Job" } } } },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
      },
      "/api/v1/jobs/{id}/stream": {
        get: {
          tags: ["Jobs"],
          summary: "Stream a job's progress (Server-Sent Events)",
          description:
            "Long-lived SSE connection. Each `data:` line is a JSON object with `{phase, progress, message, data?}`. The stream emits a final event with `phase: \"complete\"` (success) or `phase: \"failed\"` and then closes. Reconnect with the same URL after a network interruption — the next event is a fresh snapshot.",
          operationId: "streamJob",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": {
              description: "SSE stream.",
              content: { "text/event-stream": { schema: { type: "string", example: 'data: {"phase":"writing_slides","progress":0.7,"message":"Designing slides…"}\n\n' } } },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
      },
      "/api/v1/files": {
        post: {
          tags: ["Files"],
          summary: "Upload a reference file or request a presigned URL",
          description:
            "Two modes:\n\n" +
            "**Direct (multipart/form-data, ≤ 25 MB):** field `file` is the binary, field `purpose` is `reference|chat-image|template`. Returns the resulting `s3Key`.\n\n" +
            "**Presigned URL (application/json, ≤ 100 MB):** body `{fileName, contentType, purpose}`. Returns a 10-minute PUT URL the client can upload to directly. Avoid proxy bandwidth for big PPTX uploads.",
          operationId: "uploadFile",
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/FilePresignRequest" } },
              "multipart/form-data": {
                schema: {
                  type: "object",
                  properties: {
                    file: { type: "string", format: "binary" },
                    purpose: { type: "string", enum: ["reference", "chat-image", "template"], default: "reference" },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "OK. Direct mode returns FileUploadResponse, presigned mode returns FilePresignResponse.",
              content: {
                "application/json": {
                  schema: { oneOf: [{ $ref: "#/components/schemas/FilePresignResponse" }, { $ref: "#/components/schemas/FileUploadResponse" }] },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "413": { description: "File exceeds the 25 MB direct-upload cap.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
            "415": { description: "Content-Type not allowed for the chosen purpose.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          },
        },
      },
      "/api/v1/style-profiles": {
        get: {
          tags: ["Catalog"],
          summary: "List available brand-style profiles",
          description: "Returns the user's own style profiles plus the platform globals (IBM Enterprise, ICICI Bank Corporate, Wipro Consulting).",
          operationId: "listStyleProfiles",
          responses: {
            "200": {
              description: "OK",
              content: { "application/json": { schema: { type: "object", properties: { items: { type: "array", items: { $ref: "#/components/schemas/StyleProfile" } } } } } },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
          },
        },
      },
      "/api/v1/llm-configs": {
        get: {
          tags: ["Catalog"],
          summary: "List available LLM configs",
          operationId: "listLlmConfigs",
          responses: {
            "200": {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      items: { type: "array", items: { $ref: "#/components/schemas/LlmConfig" } },
                      supportedProviders: { type: "array", items: { type: "string" }, example: ["openai", "anthropic", "google", "mistral"] },
                    },
                  },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
          },
        },
      },
    },
  };
}
