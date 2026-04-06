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

  try {
    // Create a sandbox with the objects the code needs
    const sandbox = {
      slide,
      pres,
      console: {
        log: (...args: unknown[]) => logger.info({ slide: slideIndex }, ...args as [string]),
        error: (...args: unknown[]) => logger.error({ slide: slideIndex }, ...args as [string]),
      },
    };

    const context = vm.createContext(sandbox);

    // Execute the LLM-generated code in a sandboxed context
    vm.runInContext(slideData.code, context, {
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
    message: "Building PowerPoint file...",
  });

  const pres = new PptxGenJS();
  pres.layout = "LAYOUT_WIDE";
  pres.author = "SlideForge";
  pres.company = "SlideForge";

  // Check if slides contain LLM-generated code or old-style SlideSpec
  const hasCode = slides.length > 0 && typeof (slides[0] as Record<string, unknown>).code === "string";

  if (hasCode) {
    // New approach: execute LLM-generated pptxgenjs code per slide
    logger.info({ jobId, slideCount: slides.length }, "Executing LLM-generated slide code");

    for (let i = 0; i < slides.length; i++) {
      executeSlideCode(pres, slides[i] as unknown as SlideCode, i);
    }
  } else {
    // Legacy fallback: old SlideSpec approach
    logger.info({ jobId, slideCount: slides.length }, "Using legacy SlideSpec renderer");

    for (const spec of slides) {
      const s = spec as Record<string, unknown>;
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
  try {
    thumbnails = await generateThumbnails(themedBuffer, projectId, jobId);
  } catch (err) {
    logger.warn({ jobId, error: (err as Error).message }, "Thumbnail generation skipped");
  }

  // Save to DB
  const projectName = (data as Record<string, unknown>).projectName as string || "Presentation";
  try {
    const existingVersions = await prisma.presentation.count({ where: { projectId } });

    const presentation = await prisma.presentation.create({
      data: {
        projectId, title: projectName, s3Key, thumbnails,
        slideCount: slides.length, version: existingVersions + 1,
      },
    });

    await prisma.job.updateMany({
      where: { id: jobId },
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
