import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@slideforge/db";
import { getRequiredSession } from "@/lib/auth";
import { decrypt } from "@/lib/encryption";
import { logger } from "@/lib/logger";

/**
 * POST /api/projects/[id]/edit
 *
 * Surgical-edit endpoint. Loads the latest Presentation's `slidesData`,
 * passes it + a natural-language instruction to the python-agent edit
 * worker (mode="edit"), which patches only the affected slides and
 * dispatches to the node-worker for re-render.
 *
 * If the latest Presentation has no `slidesData` (predates the column),
 * we attempt graceful backfill recovery in this order:
 *   1. presentation.slidesData (the column)
 *   2. The presentation's source job's BullMQ returnvalue
 *   3. agent_memory.slide_writer output
 *   4. Fail with a clear message instructing the user to regenerate first.
 */

const editSchema = z.object({
  instruction: z.string().min(1).max(4000),
  targetSlides: z.array(z.number().int().positive()).optional(),
  modelId: z.string().min(1),
});

type SlideRecord = {
  slide_number: number;
  title: string;
  code: string;
  speaker_notes: string;
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getRequiredSession();
    const { id } = await params;
    const body = await request.json();
    const parsed = editSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const project = await prisma.project.findFirst({
      where: { id, userId: session.user.id },
      include: { styleProfile: true },
    });
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // Latest presentation = source of truth for the slide source.
    const latest = await prisma.presentation.findFirst({
      where: { projectId: id },
      orderBy: { version: "desc" },
    });
    if (!latest) {
      return NextResponse.json(
        {
          error:
            "This project doesn't have a generated deck yet. Generate one first, then come back to edit.",
        },
        { status: 400 }
      );
    }

    // Load slides — with BullMQ + agent_memory fallback for older decks
    // that predate the slidesData column.
    const slides = await loadSlidesData(latest.id, latest.jobId);
    if (!slides || slides.length === 0) {
      return NextResponse.json(
        {
          error:
            "Couldn't recover the source code for this deck (older deck or non-Preso-Elite engine). Regenerate it once and edits will work from then on.",
        },
        { status: 422 }
      );
    }

    // Resolve LLM key — same pattern as /generate.
    const llmConfig = await prisma.lLMConfig.findUnique({
      where: { id: parsed.data.modelId },
    });
    if (!llmConfig) {
      return NextResponse.json({ error: "LLM model not found" }, { status: 404 });
    }

    let apiKey: string | undefined;
    const userProviderKey = await prisma.providerApiKey.findUnique({
      where: { userId_provider: { userId: session.user.id, provider: llmConfig.provider } },
    });
    if (userProviderKey?.apiKeyEnc) {
      try { apiKey = decrypt(userProviderKey.apiKeyEnc); } catch { /* fall through */ }
    }
    if (!apiKey && llmConfig.apiKeyEnc) {
      try { apiKey = decrypt(llmConfig.apiKeyEnc); } catch { /* fall through */ }
    }
    if (!apiKey && llmConfig.provider !== "google") {
      return NextResponse.json(
        { error: `No ${llmConfig.provider} API key configured. Add one in Settings → API Keys.` },
        { status: 400 }
      );
    }

    // Snapshot brand context: prefer the theme that was actually used to
    // render the latest presentation; fall back to the project's style
    // profile (in case the deck was generated before themeSnapshot existed).
    const themeSnap = (latest.themeSnapshot as { themeConfig?: unknown } | null) || null;
    const themeConfig =
      (themeSnap?.themeConfig as Record<string, unknown> | undefined) ||
      ((project.styleProfile?.themeConfig as Record<string, unknown> | null) ?? {});

    const styleProfile = project.styleProfile as {
      styleGuide?: string;
      visualStyle?: unknown;
      layoutPatterns?: unknown;
    } | null;

    // Create a Job row and dispatch.
    const job = await prisma.job.create({
      data: {
        type: "PPT_GENERATION",
        status: "PROCESSING",
        projectId: id,
        userId: session.user.id,
        startedAt: new Date(),
        input: {
          mode: "edit",
          instruction: parsed.data.instruction,
          targetSlides: parsed.data.targetSlides ?? [],
          basePresentationId: latest.id,
          modelId: parsed.data.modelId,
        },
      },
    });

    const editJobData = {
      mode: "edit" as const,
      projectId: id,
      jobId: job.id,
      userId: session.user.id,
      basePresentationId: latest.id,
      instruction: parsed.data.instruction,
      targetSlides: parsed.data.targetSlides ?? null,
      existingSlides: slides,
      themeConfig,
      styleGuide: styleProfile?.styleGuide || "",
      visualStyle: styleProfile?.visualStyle || {},
      projectName: project.name,
      selectedModel: {
        provider: llmConfig.provider,
        model: llmConfig.model,
        baseUrl: llmConfig.baseUrl ?? undefined,
        apiKey: apiKey ?? undefined,
        temperature: llmConfig.temperature ?? 0.4,
        maxTokens: llmConfig.maxTokens ?? 16000,
      },
    };

    const { pptPythonAgentQueue } = await import("@slideforge/queue");
    await pptPythonAgentQueue.add("edit-deck", editJobData, { jobId: job.id });

    logger.info(
      { jobId: job.id, projectId: id, basePresentationId: latest.id, slideCount: slides.length },
      "Edit job enqueued"
    );

    return NextResponse.json(
      {
        jobId: job.id,
        basePresentationId: latest.id,
        slideCount: slides.length,
      },
      { status: 201 }
    );
  } catch (err) {
    if ((err as Error).message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const e = err as Error;
    logger.error(
      { error: e.message, stack: e.stack, name: e.name },
      "Failed to start edit job"
    );
    return NextResponse.json(
      {
        error: process.env.NODE_ENV === "production"
          ? "Internal server error"
          : `Edit failed: ${e.message}`,
      },
      { status: 500 }
    );
  }
}

/**
 * Recover slide source from (in order):
 *   1. presentations.slidesData
 *   2. The original job's BullMQ returnvalue (kept ~24h post-completion)
 *   3. agent_memory.slide_writer output
 *
 * Returns null if none of the sources have usable data.
 */
async function loadSlidesData(
  presentationId: string,
  jobId: string | null
): Promise<SlideRecord[] | null> {
  // 1. Direct column read.
  const pres = await prisma.presentation.findUnique({
    where: { id: presentationId },
    select: { slidesData: true },
  });
  const direct = pres?.slidesData as unknown;
  if (Array.isArray(direct) && direct.length > 0 && hasCode(direct)) {
    return normalize(direct as Array<Record<string, unknown>>);
  }

  // 2. BullMQ returnvalue. Older completed jobs may still be in Redis.
  if (jobId) {
    try {
      const { connection } = await import("@slideforge/queue");
      // Two queues to try — python-agent (older path) and node-worker (always
      // receives the slides as input, kept under its own job id space).
      for (const queue of ["ppt-python-agent", "ppt-node-worker"]) {
        const raw = await connection.hget(`bull:${queue}:${jobId}`, "returnvalue");
        if (!raw) continue;
        try {
          const parsed = JSON.parse(raw);
          // python-agent path: returnvalue contains {slides: [...]}
          if (Array.isArray(parsed?.slides) && hasCode(parsed.slides)) {
            return normalize(parsed.slides);
          }
        } catch { /* not JSON, skip */ }
      }
      // Also check if jobId is the BullMQ job id directly (different lookup).
      const directRaw = await connection.hget(`bull:ppt-python-agent:${jobId}`, "data");
      if (directRaw) {
        try {
          const parsed = JSON.parse(directRaw);
          if (Array.isArray(parsed?.slides) && hasCode(parsed.slides)) {
            return normalize(parsed.slides);
          }
        } catch { /* not JSON */ }
      }
    } catch (e) {
      logger.warn({ jobId, error: (e as Error).message }, "BullMQ recovery skipped");
    }
  }

  // 3. agent_memory.slide_writer (langgraph cache).
  if (jobId) {
    try {
      const memory = await prisma.$queryRaw<Array<{ output: unknown }>>`
        SELECT output FROM agent_memory
        WHERE "jobId" = ${jobId} AND "stepName" = 'slide_writer'
        LIMIT 1
      `;
      const row = memory[0]?.output as { slides?: unknown[] } | null;
      if (row && Array.isArray(row.slides) && hasCode(row.slides)) {
        return normalize(row.slides as Array<Record<string, unknown>>);
      }
    } catch (e) {
      logger.warn({ jobId, error: (e as Error).message }, "agent_memory recovery skipped");
    }
  }

  return null;
}

function hasCode(arr: unknown[]): boolean {
  return arr.length > 0 && typeof (arr[0] as Record<string, unknown>)?.code === "string";
}

function normalize(arr: Array<Record<string, unknown>>): SlideRecord[] {
  return arr.map((s, i) => ({
    slide_number: typeof s.slide_number === "number" ? s.slide_number : i + 1,
    title: typeof s.title === "string" ? s.title : `Slide ${i + 1}`,
    code: typeof s.code === "string" ? s.code : "",
    speaker_notes: typeof s.speaker_notes === "string" ? s.speaker_notes : "",
  }));
}
