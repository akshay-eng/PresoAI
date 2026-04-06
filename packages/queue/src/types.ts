export interface SlideSpec {
  slide_number: number;
  title: string;
  layout: "title" | "content" | "two_column" | "chart" | "image_focus";
  body_content: string;
  bullet_points: string[];
  chart_data?: {
    type: "bar" | "line" | "pie" | "area";
    labels: string[];
    series: Array<{
      name: string;
      values: number[];
    }>;
  };
  image_query?: string;
  speaker_notes: string;
}

export interface ThemeConfig {
  colors: {
    dk1: string;
    lt1: string;
    dk2: string;
    lt2: string;
    accent1: string;
    accent2: string;
    accent3: string;
    accent4: string;
    accent5: string;
    accent6: string;
    hlink: string;
    folHlink: string;
  };
  heading_font: string;
  body_font: string;
  layouts: Array<{
    name: string;
    type: string;
    placeholders: Array<{
      idx: number;
      type: string;
      x: number;
      y: number;
      w: number;
      h: number;
    }>;
  }>;
  master_background: string | null;
}

export interface PythonAgentJobData {
  projectId: string;
  jobId: string;
  prompt: string;
  numSlides: number;
  audienceType: string;
  templateS3Key?: string;
  referenceFileKeys: string[];
  selectedModel: {
    provider: string;
    model: string;
    baseUrl?: string;
    apiKey?: string;
    temperature: number;
    maxTokens: number;
  };
  langGraphThreadId: string;
}

export interface NodeWorkerJobData {
  projectId: string;
  jobId: string;
  slides: SlideSpec[];
  themeConfig: ThemeConfig;
  numSlides: number;
}

export interface FinalizeJobData {
  projectId: string;
  jobId: string;
  s3Key: string;
  thumbnails: string[];
  slideCount: number;
  title: string;
}

export interface ProgressEvent {
  phase: string;
  progress: number;
  message: string;
  data?: unknown;
}
