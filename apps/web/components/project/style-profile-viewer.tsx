"use client";

import { useQuery } from "@tanstack/react-query";
import { Palette, Type, Layout, Shapes, Eye, BookOpen, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

interface StyleProfileViewerProps {
  profileId: string | null;
}

interface VisualStyle {
  design_language?: string; brand_personality?: string; color_usage?: string;
  content_density?: string; visual_hierarchy?: string; spacing_pattern?: string;
  typography_treatment?: string; graphic_elements?: string; chart_style?: string;
}

interface LayoutPattern {
  layout_type: string; frequency: number; description: string;
  content_density: string; typical_elements: string[];
}

interface ProfileData {
  id: string; name: string; status: string; styleGuide?: string;
  themeConfig?: Record<string, string>; visualStyle?: VisualStyle;
  layoutPatterns?: LayoutPattern[];
  sourceFiles: Array<{ id: string; fileName: string; slideCount: number; status: string }>;
}

function ColorSwatch({ color, label }: { color: string; label: string }) {
  const hex = color.startsWith("#") ? color : `#${color}`;
  return (
    <div className="flex items-center gap-2">
      <div className="w-6 h-6 rounded border border-border shrink-0" style={{ backgroundColor: hex }} title={hex} />
      <div className="min-w-0">
        <p className="text-[10px] font-mono text-muted-foreground/60">{hex}</p>
        <p className="text-[10px] text-muted-foreground/40 truncate">{label}</p>
      </div>
    </div>
  );
}

function Section({ icon: Icon, title, children }: { icon: React.ElementType; title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold">
        <Icon className="h-3.5 w-3.5 text-primary" />
        {title}
      </h3>
      {children}
    </div>
  );
}

export function StyleProfileViewer({ profileId }: StyleProfileViewerProps) {
  const { data, isLoading } = useQuery({
    queryKey: ["style-profile-detail", profileId],
    queryFn: async () => {
      if (!profileId) return null;
      const res = await fetch(`/api/style-profiles/${profileId}`);
      if (!res.ok) return null;
      return res.json() as Promise<ProfileData>;
    },
    enabled: !!profileId,
  });

  if (!profileId) return null;
  if (isLoading) return <Skeleton className="h-40 w-full rounded-xl" />;
  if (!data || data.status !== "ready") return null;

  const colors = data.themeConfig || {};
  const vs = data.visualStyle || {};
  const layouts = data.layoutPatterns || [];

  return (
    <div className="mt-3 rounded-xl border border-border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold flex items-center gap-1.5">
          <Eye className="h-3.5 w-3.5 text-primary" />
          {data.name}
        </p>
        <Badge variant="outline" className="text-[10px]">{data.sourceFiles?.length || 0} files</Badge>
      </div>
      {vs.design_language && <p className="text-[11px] text-muted-foreground">{vs.design_language}</p>}

      <div className="space-y-3 text-xs">
        <Section icon={Palette} title="Colors">
          <div className="grid grid-cols-3 gap-2">
            {colors.accent1 && <ColorSwatch color={colors.accent1} label="Accent 1" />}
            {colors.accent2 && <ColorSwatch color={colors.accent2} label="Accent 2" />}
            {colors.accent3 && <ColorSwatch color={colors.accent3} label="Accent 3" />}
            {colors.accent4 && <ColorSwatch color={colors.accent4} label="Accent 4" />}
            {colors.dk1 && <ColorSwatch color={colors.dk1} label="Dark 1" />}
            {colors.lt1 && <ColorSwatch color={colors.lt1} label="Light 1" />}
          </div>
          {vs.color_usage && <p className="text-muted-foreground mt-1.5">{vs.color_usage}</p>}
        </Section>

        {vs.typography_treatment && (<><Separator /><Section icon={Type} title="Typography"><p className="text-muted-foreground">{vs.typography_treatment}</p></Section></>)}
        {layouts.length > 0 && (<><Separator /><Section icon={Layout} title="Layouts"><div className="space-y-1.5">{layouts.map((lp, i) => (<div key={i} className="rounded border border-border p-2 bg-muted/20"><p className="font-medium text-foreground/80">{lp.description}</p>{lp.typical_elements?.length > 0 && <div className="flex flex-wrap gap-1 mt-1">{lp.typical_elements.map((el, j) => <Badge key={j} variant="outline" className="text-[9px]">{el}</Badge>)}</div>}</div>))}</div></Section></>)}
        {vs.graphic_elements && (<><Separator /><Section icon={Shapes} title="Visual Elements"><p className="text-muted-foreground">{vs.graphic_elements}</p>{vs.chart_style && <p className="text-muted-foreground mt-1">{vs.chart_style}</p>}</Section></>)}
        {(vs.content_density || vs.spacing_pattern) && (<><Separator /><Section icon={BookOpen} title="Content"><>{vs.content_density && <p className="text-muted-foreground">{vs.content_density}</p>}{vs.spacing_pattern && <p className="text-muted-foreground mt-1">{vs.spacing_pattern}</p>}{vs.visual_hierarchy && <p className="text-muted-foreground mt-1">{vs.visual_hierarchy}</p>}</></Section></>)}
        {vs.brand_personality && (<><Separator /><Section icon={Sparkles} title="Personality"><p className="text-muted-foreground">{vs.brand_personality}</p></Section></>)}
      </div>
    </div>
  );
}
