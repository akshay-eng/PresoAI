"use client";

interface ThemePreviewProps {
  themeConfig: {
    colors?: Record<string, string>;
    heading_font?: string;
    body_font?: string;
  } | null;
}

export function ThemePreview({ themeConfig }: ThemePreviewProps) {
  if (!themeConfig?.colors) {
    return <div className="text-xs text-muted-foreground/50">No theme extracted yet</div>;
  }

  const colors = themeConfig.colors;
  const colorEntries = Object.entries(colors).filter(
    ([, val]) => typeof val === "string" && val.startsWith("#")
  );

  return (
    <div className="space-y-2.5">
      <div>
        <p className="text-[10px] font-medium text-muted-foreground/50 mb-1">Colors</p>
        <div className="flex flex-wrap gap-1">
          {colorEntries.map(([name, color]) => (
            <div key={name} className="group relative">
              <div
                className="h-5 w-5 rounded border border-border"
                style={{ backgroundColor: color }}
                title={`${name}: ${color}`}
              />
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block bg-popover text-popover-foreground text-[10px] px-1.5 py-0.5 rounded shadow-lg border border-border whitespace-nowrap z-10">
                {name}: {color}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div>
        <p className="text-[10px] font-medium text-muted-foreground/50 mb-0.5">Fonts</p>
        <p className="text-xs text-muted-foreground">
          <span style={{ fontFamily: themeConfig.heading_font }}>{themeConfig.heading_font || "Default"}</span>
          {" / "}
          <span style={{ fontFamily: themeConfig.body_font }}>{themeConfig.body_font || "Default"}</span>
        </p>
      </div>
    </div>
  );
}
