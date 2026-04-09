import { z } from "zod";

export const createProjectSchema = z.object({
  name: z.string().min(1).max(255),
  prompt: z.string().max(10000).default(""),
  numSlides: z.number().int().min(1).max(15).default(10),
  audienceType: z.enum(["executive", "technical", "general"]).default("general"),
  templateId: z.string().optional(),
  llmConfigId: z.string().optional(),
});

export const updateProjectSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  prompt: z.string().min(1).max(10000).optional(),
  numSlides: z.number().int().min(1).max(15).optional(),
  audienceType: z.enum(["executive", "technical", "general"]).optional(),
  templateId: z.string().nullable().optional(),
  llmConfigId: z.string().nullable().optional(),
});

export const generatePresentationSchema = z.object({
  prompt: z.string().min(1).max(10000),
  numSlides: z.number().int().min(1).max(15),
  audienceType: z.enum(["executive", "technical", "general"]),
  modelId: z.string().min(1),
  engine: z.enum(["claude-code", "claude-gemini", "node-worker"]).default("claude-code"),
  creativeMode: z.boolean().default(false),
  chatImageKeys: z.array(z.string()).optional(),
});

export const presignUploadSchema = z.object({
  fileName: z.string().min(1).max(500),
  contentType: z.string().min(1),
  purpose: z.enum(["template", "reference", "general", "chat-image"]),
});

export const approveJobSchema = z.object({
  approved: z.boolean(),
  editedOutline: z
    .array(
      z.object({
        title: z.string(),
        layout: z.string(),
        key_points: z.array(z.string()),
        notes: z.string(),
      })
    )
    .optional(),
  feedback: z.string().optional(),
});

export const createLLMConfigSchema = z.object({
  name: z.string().min(1).max(255),
  provider: z.enum(["openai", "azure", "anthropic", "google", "mistral", "custom"]),
  model: z.string().min(1).max(255),
  baseUrl: z.string().url().optional(),
  apiKey: z.string().min(1).optional(),
  temperature: z.number().min(0).max(2).default(0.7),
  maxTokens: z.number().int().min(1).max(128000).default(4096),
});

export const registerSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(255),
  password: z.string().min(8).max(128),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
