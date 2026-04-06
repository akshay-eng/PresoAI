/**
 * PPTX Agent — Uses Claude Code CLI to generate presentations.
 *
 * This spawns a Claude Code subprocess with:
 * - The pptx skill loaded (design guidelines, pptxgenjs tutorial, editing workflow)
 * - The user's style profile context (colors, layouts, visual analysis)
 * - The slide outline + research content
 * - Full filesystem access to write pptxgenjs code and execute it
 *
 * Claude Code actually WRITES and RUNS the code, iterating on errors,
 * giving it full control over every visual element.
 */

import { execFile, spawn } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const execFileAsync = promisify(execFile);

interface GenerateOptions {
  prompt: string;
  numSlides: number;
  audience: string;
  outline: Array<{ title: string; layout: string; key_points: string[]; notes: string }>;
  researchSummary: string;
  styleGuide: string;
  knowledgeGraphContext: string;
  outputPath: string;
  useGemini?: boolean;
}

/**
 * Generate a PPTX presentation using Claude Code as the agent.
 */
export async function generatePptx(options: GenerateOptions): Promise<string> {
  const {
    prompt,
    numSlides,
    audience,
    outline,
    researchSummary,
    styleGuide,
    knowledgeGraphContext,
    outputPath,
  } = options;

  // Create a temporary workspace for the agent
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "slideforge-pptx-"));
  const outFile = path.join(workDir, "presentation.pptx");

  // Install pptxgenjs in the workspace
  await execFileAsync("npm", ["init", "-y"], { cwd: workDir });
  await execFileAsync("npm", ["install", "pptxgenjs"], { cwd: workDir, timeout: 60000 });

  // Build a concise CLAUDE.md — keep under 5KB to avoid rate limits
  const skillDir = path.resolve(__dirname, "../../../pptx");
  const pptxgenGuide = fs.existsSync(path.join(skillDir, "pptxgenjs.md"))
    ? fs.readFileSync(path.join(skillDir, "pptxgenjs.md"), "utf-8").substring(0, 4000)
    : "";

  const claudeMd = buildClaudeMd({
    pptxgenGuide,
    skillGuide: "", // Skip the full skill guide — essentials are in the prompt
    styleGuide: styleGuide.substring(0, 2000),
    knowledgeGraphContext: knowledgeGraphContext.substring(0, 1000),
  });
  fs.writeFileSync(path.join(workDir, "CLAUDE.md"), claudeMd);

  // Build the prompt for Claude Code
  const agentPrompt = buildAgentPrompt({
    prompt,
    numSlides,
    audience,
    outline,
    researchSummary,
    outFile,
    styleGuide,
    knowledgeGraphContext,
  });

  console.log(`[pptx-agent] Workspace: ${workDir}`);
  console.log(`[pptx-agent] Generating ${numSlides} slides...`);

  // Run Claude Code with the prompt
  const result = await runClaudeCode(workDir, agentPrompt, options.useGemini || false);

  // Check if the file was created
  if (fs.existsSync(outFile)) {
    // Copy to final output path
    fs.copyFileSync(outFile, outputPath);
    console.log(`[pptx-agent] PPTX generated: ${outputPath}`);
    return outputPath;
  }

  // Check if it was created with a different name
  const pptxFiles = fs.readdirSync(workDir).filter((f) => f.endsWith(".pptx"));
  if (pptxFiles.length > 0) {
    const src = path.join(workDir, pptxFiles[0]!);
    fs.copyFileSync(src, outputPath);
    console.log(`[pptx-agent] PPTX generated (alt name): ${outputPath}`);
    return outputPath;
  }

  throw new Error("Claude Code did not generate a PPTX file. Output:\n" + result.substring(0, 1000));
}

function buildClaudeMd(ctx: {
  pptxgenGuide: string;
  skillGuide: string;
  styleGuide: string;
  knowledgeGraphContext: string;
}): string {
  return `# SlideForge PPTX Generator

You are a presentation designer. Create a STUNNING PowerPoint file using pptxgenjs.

## Rules
- Use pptxgenjs (already installed in node_modules) to create the PPTX
- Write a single generate.js file and run it with node
- Output MUST be "presentation.pptx" in the current directory
- NEVER use "#" prefix in hex colors — pptxgenjs uses 6-char hex without #
- Create CATALOGUE-QUALITY slides — like a premium corporate brochure

## CRITICAL LAYOUT RULES — NO OVERLAPPING
- LAYOUT_WIDE is 13.33" wide x 7.5" tall. NEVER place elements outside these bounds.
- Plan your layout on a GRID before coding. Divide the slide into clear zones.
- Leave 0.5" margins on all sides (usable area: 0.5 to 12.83 x, 0.5 to 7.0 y)
- Track y position as you add elements. Each element's y must be AFTER the previous one.
- For card grids: calculate exact widths. 3 cards = each ~3.8" wide with 0.3" gaps.
- For flow steps: calculate exact positions. N steps across = (12.33 / N) per step.
- NEVER stack more than 2 major content sections vertically on one slide. If needed, use multiple slides.
- Test: no element's (y + h) should exceed 7.0, no element's (x + w) should exceed 13.0

## Visual QA Step (MANDATORY)
After generating presentation.pptx, you MUST do a visual QA:
1. Convert the PPTX to images: run \`soffice --headless --convert-to png presentation.pptx\` or \`soffice --headless --convert-to pdf presentation.pptx\`
2. Look at the output image/thumbnail to check for overlapping elements
3. If elements overlap or go off-screen, fix generate.js and re-run
4. Only finish when the slides look clean and professional

## pptxgenjs Reference
${ctx.pptxgenGuide}

${ctx.styleGuide ? `## Style Profile from Reference Deck\n${ctx.styleGuide}` : ""}

${ctx.knowledgeGraphContext ? `## User's Design Preferences\n${ctx.knowledgeGraphContext}` : ""}
`;
}

function buildAgentPrompt(ctx: {
  prompt: string;
  numSlides: number;
  audience: string;
  outline: Array<{ title: string; layout: string; key_points: string[]; notes: string }>;
  researchSummary: string;
  outFile: string;
  styleGuide: string;
  knowledgeGraphContext: string;
}): string {
  const outlineText = ctx.outline
    .map((s, i) => `Slide ${i + 1}: "${s.title}" (${s.layout})\n  Points: ${s.key_points.join("; ")}`)
    .join("\n");

  const styleSection = ctx.styleGuide
    ? `\n## CRITICAL: Style Profile (from user's reference deck — MATCH THIS)\n${ctx.styleGuide.substring(0, 3000)}\n`
    : "";

  const kgSection = ctx.knowledgeGraphContext
    ? `\n## User's Design Preferences (from knowledge graph)\n${ctx.knowledgeGraphContext.substring(0, 1000)}\n`
    : "";

  return `Create a CATALOGUE-QUALITY PowerPoint presentation using pptxgenjs. Read the CLAUDE.md for the full pptxgenjs API reference and design guidelines, then write generate.js and run it.

## Topic
${ctx.prompt}

## Audience
${ctx.audience}

## Slide Outline (${ctx.numSlides} slides)
${outlineText}

## Research Context
${ctx.researchSummary.substring(0, 2000)}
${styleSection}${kgSection}
## Requirements
1. Read CLAUDE.md first — it has the pptxgenjs API, layout rules, and visual QA process
2. Write generate.js using pptxgenjs (require from node_modules)
3. Use LAYOUT_WIDE (13.33" x 7.5"). Usable area: x=0.5-12.83, y=0.5-7.0
4. Create ${ctx.numSlides} visually stunning slides
5. IMPORTANT: Use the EXACT colors from the style profile above
6. Each slide MUST have: colored backgrounds, card containers, accent bars, visual hierarchy
7. Use card grids, stat callout boxes, numbered flow steps — NOT plain bullet lists

## CRITICAL: Layout & Spacing
- Plan positions mathematically BEFORE coding. Don't guess.
- For N cards in a row: width = (12.33 - (N-1)*0.3) / N, gap = 0.3
- Track cumulative Y position. Never let elements overlap.
- If content won't fit in one slide, use fewer items or split across slides.
- MAX 2 major sections per slide (e.g., "Traditional Flow" + "Modern Flow" is the limit)
- Leave 0.3" breathing room between sections

## MANDATORY: Visual QA After Generation
After creating presentation.pptx:
1. Convert to image: soffice --headless --convert-to png presentation.pptx
2. View the PNG and check for: overlapping text, elements going off-screen, cramped spacing
3. If issues found: fix generate.js positions/sizes and re-run
4. Only finish when slides look CLEAN and PROFESSIONAL

Save as "presentation.pptx" and run with: node generate.js`;
}

async function runClaudeCode(cwd: string, prompt: string, useGemini: boolean = false): Promise<string> {
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
  };

  if (useGemini) {
    // Route ALL requests through the proxy — no Anthropic API needed
    env.ANTHROPIC_BASE_URL = process.env.CLAUDE_PROXY_URL || "http://localhost:8082";
    // Dummy key — the proxy uses GEMINI_API_KEY from its own .env
    env.ANTHROPIC_API_KEY = "sk-ant-dummy-key-for-proxy";
    console.log(`[pptx-agent] Using Gemini via proxy at ${env.ANTHROPIC_BASE_URL} (no Anthropic API calls)`);
  } else {
    env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
  }

  // Write prompt to a temp file to avoid shell escaping issues with long prompts
  const promptFile = path.join(cwd, ".prompt.txt");
  fs.writeFileSync(promptFile, prompt, "utf-8");

  // Use bash -c to pipe the prompt file into claude via stdin
  const cmd = `cat "${promptFile}" | claude -p --output-format text --dangerously-skip-permissions --allowedTools "Bash Edit Write Read Glob Grep"`;

  try {
    const { stdout, stderr } = await execFileAsync("bash", ["-c", cmd], {
      cwd,
      env,
      timeout: 300000,
      maxBuffer: 10 * 1024 * 1024,
    });

    if (stdout) console.log(`[claude] ${stdout.substring(0, 2000)}`);
    if (stderr && !stderr.includes("ExperimentalWarning")) {
      console.error(`[claude-err] ${stderr.substring(0, 500)}`);
    }

    return stdout || "";
  } catch (err: unknown) {
    const error = err as { stdout?: string; stderr?: string; code?: number; message: string };

    // Even if exit code is non-zero, check if the PPTX was created
    if (fs.existsSync(path.join(cwd, "presentation.pptx"))) {
      console.log("[claude] Process exited with error but PPTX was created — treating as success");
      return error.stdout || "PPTX created despite exit code";
    }

    // Log more detail
    console.error(`[claude-err] Exit code: ${error.code}`);
    if (error.stdout) console.error(`[claude-stdout] ${error.stdout.substring(0, 500)}`);
    if (error.stderr) console.error(`[claude-stderr] ${error.stderr.substring(0, 500)}`);
    throw new Error(`Claude Code failed (exit ${error.code}): ${(error.stderr || error.message).substring(0, 300)}`);
  } finally {
    try { fs.unlinkSync(promptFile); } catch {}
  }
}

// CLI entry point
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.log("Usage: tsx generate.ts <prompt> <output.pptx> [--slides N] [--style-guide <file>]");
    process.exit(1);
  }

  const prompt = args[0]!;
  const outputPath = args[1]!;
  const numSlides = parseInt(args[args.indexOf("--slides") + 1] || "5", 10);
  const styleGuideFile = args.indexOf("--style-guide") >= 0 ? args[args.indexOf("--style-guide") + 1] : undefined;

  const styleGuide = styleGuideFile && fs.existsSync(styleGuideFile)
    ? fs.readFileSync(styleGuideFile, "utf-8")
    : "";

  generatePptx({
    prompt,
    numSlides,
    audience: "technical",
    outline: [{ title: prompt, layout: "content", key_points: [prompt], notes: "" }],
    researchSummary: "",
    styleGuide,
    knowledgeGraphContext: "",
    outputPath,
  })
    .then(() => console.log("Done!"))
    .catch((err) => {
      console.error("Failed:", err.message);
      process.exit(1);
    });
}
