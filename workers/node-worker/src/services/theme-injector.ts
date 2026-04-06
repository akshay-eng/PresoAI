import JSZip from "jszip";
import pino from "pino";
import type { ThemeConfig } from "@slideforge/queue";

const logger = pino({ name: "theme-injector" });

function stripHash(color: string): string {
  return color.startsWith("#") ? color.slice(1) : color;
}

const COLOR_ELEMENT_MAP: Record<string, string> = {
  dk1: "dk1",
  lt1: "lt1",
  dk2: "dk2",
  lt2: "lt2",
  accent1: "accent1",
  accent2: "accent2",
  accent3: "accent3",
  accent4: "accent4",
  accent5: "accent5",
  accent6: "accent6",
  hlink: "hlink",
  folHlink: "folHlink",
};

export async function injectTheme(
  pptxBuffer: Buffer,
  theme: ThemeConfig
): Promise<Buffer> {
  const zip = await JSZip.loadAsync(pptxBuffer);
  const themeFile = zip.file("ppt/theme/theme1.xml");

  if (!themeFile) {
    logger.warn("No theme1.xml found in PPTX, skipping theme injection");
    return pptxBuffer;
  }

  let themeXml = await themeFile.async("text");

  for (const [key, elementName] of Object.entries(COLOR_ELEMENT_MAP)) {
    const colorKey = key as keyof typeof theme.colors;
    const hexColor = stripHash(theme.colors[colorKey]);

    // Replace srgbClr val within the color element
    const srgbPattern = new RegExp(
      `(<a:${elementName}>\\s*<a:srgbClr\\s+val=")[0-9A-Fa-f]{6}("\\s*/>)`,
      "g"
    );
    themeXml = themeXml.replace(srgbPattern, `$1${hexColor}$2`);

    // Also handle sysClr lastClr pattern
    const sysClrPatternStr = '(<a:' + elementName + '>\\s*<a:sysClr[^>]*lastClr=")[0-9A-Fa-f]{6}(")';
    const sysClrPattern = new RegExp(sysClrPatternStr, "g");
    themeXml = themeXml.replace(sysClrPattern, "$1" + hexColor + "$2");
  }

  // Replace major font (heading)
  themeXml = themeXml.replace(
    /(<a:majorFont>[\s\S]*?<a:latin\s+typeface=")[^"]*(")/g,
    `$1${theme.heading_font}$2`
  );

  // Replace minor font (body)
  themeXml = themeXml.replace(
    /(<a:minorFont>[\s\S]*?<a:latin\s+typeface=")[^"]*(")/g,
    `$1${theme.body_font}$2`
  );

  zip.file("ppt/theme/theme1.xml", themeXml);

  const result = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  logger.info("Theme injected successfully");
  return result;
}
