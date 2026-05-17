import PptxGenJS from "pptxgenjs";
import pino from "pino";
import vm from "vm";
import type { NodeWorkerJobData, ThemeConfig } from "@slideforge/queue";
import { prisma } from "@slideforge/db";
import { injectTheme } from "./theme-injector";
import { generateThumbnails } from "./thumbnail-generator";
import { uploadToS3 } from "./s3-client";
import { publishProgress } from "./redis-publisher";

const logger = pino({ name: "pptx-generator" });

// Minimal fallback theme — only used when no analysis data exists
const BARE_FALLBACK_THEME: ThemeConfig = {
  colors: {
    dk1: "#1A1A2E", lt1: "#FFFFFF", dk2: "#16213E", lt2: "#F5F5F5",
    accent1: "#0F3460", accent2: "#E94560", accent3: "#533483",
    accent4: "#00B4D8", accent5: "#48C9B0", accent6: "#F39C12",
    hlink: "#0F3460", folHlink: "#533483",
  },
  heading_font: "Calibri", body_font: "Calibri", layouts: [], master_background: null,
};

function mergeTheme(provided: Partial<ThemeConfig>): ThemeConfig {
  return {
    ...BARE_FALLBACK_THEME, ...provided,
    colors: { ...BARE_FALLBACK_THEME.colors, ...(provided.colors || {}) },
  };
}

interface SlideCode {
  slide_number: number;
  title: string;
  speaker_notes?: string;
  code: string;
}

const PYTHON_AGENT_URL =
  process.env.PYTHON_AGENT_URL ||
  process.env.PPTX_AGENT_URL?.replace(":8100", ":8000") ||
  "http://localhost:8000";

/**
 * Pick a clean PPTX title from the deck's content. Prefers the cover
 * slide's title (which is usually a punchy headline like "From Reactive
 * Chaos to Autonomous Resilience"), and runs it through python-agent's
 * /summarize-name to strip stray section numbers, eyebrows, or markdown.
 * Falls back to the cover title verbatim, or the project name.
 */
async function derivePresentationTitle(args: {
  coverTitle: string;
  slideTitles: string[];
  projectName: string;
}): Promise<string> {
  const { coverTitle, slideTitles, projectName } = args;
  const seed = coverTitle?.trim() || slideTitles[0]?.trim() || projectName;
  if (!seed) return "Presentation";

  // If the cover title is already short and clean, use it as-is — no need
  // to round-trip through the LLM.
  const looksClean = seed.length <= 60 && !/[\\/:*?"<>|\[\]()`~]/.test(seed);
  if (looksClean) return seed;

  // Otherwise summarize via python-agent (server-side Gemini key).
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(`${PYTHON_AGENT_URL}/summarize-name`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: seed, kind: "presentation" }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (res.ok) {
      const data = (await res.json()) as { name?: string };
      if (data?.name) return data.name;
    }
  } catch (err) {
    logger.warn(
      { err: (err as Error).message },
      "Presentation title summarization failed, using cover title"
    );
  }

  // Last resort — sanitize the cover title for filename safety.
  return seed.replace(/[\\/:*?"<>|\[\]()`~]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "Presentation";
}

/**
 * Strip patterns that the LLM emits but that crash pptxgenjs at write time.
 *
 * `transparency: <num>` is only valid INSIDE a shape's `fill: {...}` object.
 * If the LLM puts it at the root of an addText / addShape options object,
 * pptxgenjs internally builds a structured color value that later blows up
 * `createColorElement`. Cheaper to scrub at source than to guard the whole
 * pipeline.
 */
function sanitizeSlideCode(code: string): string {
  let out = code;

  // (1) Strip stray `transparency: <num>` from text/shape option roots —
  //     pptxgenjs only accepts it inside fill: {...} on shapes.
  out = out
    .replace(/,\s*transparency\s*:\s*-?\d+(?:\.\d+)?/g, "")
    .replace(/transparency\s*:\s*-?\d+(?:\.\d+)?\s*,/g, "");

  // (2) pptxgenjs has a footgun in addBackgroundDefinition: writing
  //     `slide.background = { fill: { type:'solid', color:'HEX' } }` causes
  //     it to assign the whole fill object to `.color`, and the XML
  //     serializer crashes on `(obj || "").replace`. Only `{ color: 'HEX' }`
  //     and `{ path: '...' }` are supported. Rewrite the broken form back
  //     to the working one before executing.
  out = out.replace(
    /slide\.background\s*=\s*\{\s*fill\s*:\s*\{[^{}]*?color\s*:\s*(['"])([0-9A-Fa-f]{6})\1[^{}]*?\}\s*\}\s*;?/g,
    "slide.background = { color: '$2' };"
  );

  return out;
}

/**
 * Execute LLM-generated pptxgenjs code for a single slide.
 * The code has access to `slide` and `pres` objects.
 */
function executeSlideCode(
  pres: InstanceType<typeof PptxGenJS>,
  slideData: SlideCode,
  slideIndex: number
): void {
  const slide = pres.addSlide();

  /**
   * Embed an SVG string as an image on the slide. Useful when the model needs
   * gradients, rotated parallelograms, glass/glow effects, or any geometry
   * pptxgenjs's native shape API can't express. The model writes SVG as a
   * plain string (gradients, transforms, filters all welcome) and we handle
   * the base64 + data-URI encoding here so the LLM never has to.
   */
  function embedSvg(
    svg: string,
    opts: { x: number; y: number; w: number; h: number; rotate?: number; transparency?: number }
  ) {
    const b64 = Buffer.from(svg, "utf8").toString("base64");
    slide.addImage({
      data: `image/svg+xml;base64,${b64}`,
      ...opts,
    });
  }

  try {
    // Create a sandbox with the objects the code needs
    const sandbox = {
      slide,
      pres,
      embedSvg,
      Buffer,
      Math,
      console: {
        log: (...args: unknown[]) => logger.info({ slide: slideIndex }, ...args as [string]),
        error: (...args: unknown[]) => logger.error({ slide: slideIndex }, ...args as [string]),
      },
    };

    const context = vm.createContext(sandbox);

    const safeCode = sanitizeSlideCode(slideData.code);

    // Execute the LLM-generated code in a sandboxed context
    vm.runInContext(safeCode, context, {
      timeout: 10000, // 10 second timeout per slide
      filename: `slide-${slideIndex + 1}.js`,
    });

    // Add speaker notes
    if (slideData.speaker_notes) {
      slide.addNotes(slideData.speaker_notes);
    }

    logger.info({ slideIndex, title: slideData.title }, "Slide code executed");
  } catch (err) {
    logger.error(
      { slideIndex, title: slideData.title, error: (err as Error).message },
      "Slide code execution failed, adding fallback"
    );

    // Fallback: create a simple slide with the title
    slide.background = { color: "FFFFFF" };
    slide.addText(slideData.title || `Slide ${slideIndex + 1}`, {
      x: 0.5, y: 2.5, w: 12, h: 2,
      fontSize: 28, fontFace: "Calibri", color: "1A1A2E",
      bold: true, align: "center", valign: "middle",
    });

    if (slideData.speaker_notes) {
      slide.addNotes(slideData.speaker_notes);
    }
  }
}

export async function processNodeWorkerJob(
  data: NodeWorkerJobData
): Promise<{ s3Key: string; thumbnails: string[] }> {
  const { projectId, jobId, slides, themeConfig: rawTheme } = data;
  const theme = mergeTheme(rawTheme || {});

  await publishProgress(jobId, {
    phase: "building_pptx",
    progress: 0.9,
    message: `Rendering ${slides.length} slides...`,
    data: { currentSlideIndex: 0, totalSlides: slides.length },
  });

  const pres = new PptxGenJS();
  pres.layout = "LAYOUT_WIDE";
  pres.author = "SlideForge";
  pres.company = "SlideForge";

  // Check if slides contain LLM-generated code or old-style SlideSpec
  const hasCode = slides.length > 0 && typeof (slides[0] as unknown as Record<string, unknown>).code === "string";

  if (hasCode) {
    // New approach: execute LLM-generated pptxgenjs code per slide
    logger.info({ jobId, slideCount: slides.length }, "Executing LLM-generated slide code");

    for (let i = 0; i < slides.length; i++) {
      executeSlideCode(pres, slides[i] as unknown as SlideCode, i);

      // Per-slide progress tick. The sidebar uses `currentSlideIndex` to
      // mark slides 1..i as done and only animate slide i+1. We progress
      // linearly from 0.90 → 0.92 across the slide loop so the global
      // bar nudges forward too.
      const fraction = (i + 1) / slides.length;
      await publishProgress(jobId, {
        phase: "building_pptx",
        progress: 0.9 + 0.02 * fraction,
        message: `Rendered slide ${i + 1} of ${slides.length}`,
        data: {
          currentSlideIndex: i + 1,
          totalSlides: slides.length,
          completedSlideIndex: i,
        },
      });
    }
  } else {
    // Legacy fallback: old SlideSpec approach
    logger.info({ jobId, slideCount: slides.length }, "Using legacy SlideSpec renderer");

    for (const spec of slides) {
      const s = spec as unknown as Record<string, unknown>;
      const slide = pres.addSlide();
      slide.background = { color: "FFFFFF" };

      slide.addText((s.title as string) || "Slide", {
        x: 0.5, y: 0.3, w: 12, h: 0.8,
        fontSize: 28, fontFace: theme.heading_font, color: "1A1A2E", bold: true,
      });

      const bullets = (s.bullet_points as string[]) || [];
      if (bullets.length > 0) {
        slide.addText(
          bullets.map((bp: string) => ({
            text: bp,
            options: { bullet: true, breakLine: true, fontSize: 16, color: "333333" },
          })),
          { x: 0.5, y: 1.5, w: 12, h: 5 }
        );
      }

      if (s.speaker_notes) {
        slide.addNotes(s.speaker_notes as string);
      }
    }
  }

  logger.info({ jobId, slideCount: slides.length }, "Slides built");

  const buffer = (await pres.write({ outputType: "nodebuffer" })) as Buffer;

  await publishProgress(jobId, {
    phase: "injecting_theme",
    progress: 0.92,
    message: "Injecting custom theme...",
  });

  const themedBuffer = await injectTheme(buffer, theme);

  const s3Key = `generated/${projectId}/${jobId}/presentation.pptx`;
  await uploadToS3(
    themedBuffer, s3Key,
    "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  );

  await publishProgress(jobId, {
    phase: "generating_thumbnails",
    progress: 0.95,
    message: "Generating slide thumbnails...",
  });

  let thumbnails: string[] = [];
  let pdfS3Key: string | null = null;
  try {
    const thumbResult = await generateThumbnails(themedBuffer, projectId, jobId);
    thumbnails = thumbResult.thumbnails;
    pdfS3Key = thumbResult.pdfS3Key;
  } catch (err) {
    logger.warn({ jobId, error: (err as Error).message }, "Thumbnail generation skipped");
  }

  // Save to DB
  const projectName = (data as unknown as Record<string, unknown>).projectName as string || "Presentation";
  try {
    const existingVersions = await prisma.presentation.count({ where: { projectId } });

    // Persist the per-slide pptxgenjs source so future edit prompts can
    // patch a single slide without re-running the research → outline →
    // slide_writer pipeline. We strip down to the fields the edit agent
    // needs — code, title, slide_number, speaker_notes — and drop any
    // visual_parts or transient state from the original LLM payload.
    const slidesData = (slides as unknown as Array<Record<string, unknown>>).map((s, idx) => ({
      slide_number: typeof s.slide_number === "number" ? s.slide_number : idx + 1,
      title: typeof s.title === "string" ? s.title : `Slide ${idx + 1}`,
      code: typeof s.code === "string" ? s.code : "",
      speaker_notes: typeof s.speaker_notes === "string" ? s.speaker_notes : "",
    }));

    const themeSnapshot = {
      themeConfig: rawTheme || {},
      mergedTheme: theme,
    };

    // Derive the PPTX title from the cover slide's title — that's the
    // most semantically meaningful summary of the deck. Falls back to
    // the project name if the cover title looks empty / generic, and
    // finally to the project name. Title-case + filename-safe.
    const presentationTitle = await derivePresentationTitle({
      coverTitle: slidesData[0]?.title || "",
      slideTitles: slidesData.map((s) => s.title).filter(Boolean),
      projectName,
    });

    const presentation = await prisma.presentation.create({
      data: {
        projectId, title: presentationTitle, s3Key, thumbnails,
        slideCount: slides.length, version: existingVersions + 1,
        // Prisma's JSON input type is Record<string, JsonValue>; ThemeConfig
        // is a structural interface without an index signature, so cast.
        // The shape itself is JSON-serializable.
        slidesData: slidesData as unknown as object,
        themeSnapshot: themeSnapshot as unknown as object,
        ...(pdfS3Key ? { pdfS3Key } : {}),
      },
    });

    await prisma.job.updateMany({
      where: { OR: [{ id: jobId }, { bullmqJobId: jobId }] },
      data: {
        status: "COMPLETED", progress: 1.0, currentPhase: "complete",
        output: { s3Key, thumbnails, slideCount: slides.length, presentationId: presentation.id },
        completedAt: new Date(),
      },
    });

    await publishProgress(jobId, {
      phase: "complete", progress: 1.0, message: "Presentation ready!",
      data: { s3Key, thumbnails, slideCount: slides.length, presentationId: presentation.id },
    });
  } catch (dbErr) {
    logger.error({ jobId, error: (dbErr as Error).message }, "DB update failed");
    await publishProgress(jobId, {
      phase: "complete", progress: 1.0, message: "Presentation ready!",
      data: { s3Key, thumbnails, slideCount: slides.length },
    });
  }

  logger.info({ jobId, s3Key }, "Job complete");
  return { s3Key, thumbnails };
}
