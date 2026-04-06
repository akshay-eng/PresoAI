const BASE_URL = "";

async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || `API error: ${res.status}`);
  }

  return res.json();
}

export const api = {
  // Projects
  listProjects: (cursor?: string, search?: string) => {
    const params = new URLSearchParams();
    if (cursor) params.set("cursor", cursor);
    if (search) params.set("search", search);
    return fetchApi<{
      items: unknown[];
      nextCursor?: string;
      hasMore: boolean;
    }>(`/api/projects?${params}`);
  },

  createProject: (data: {
    name: string;
    prompt: string;
    numSlides?: number;
    audienceType?: string;
  }) => fetchApi<unknown>("/api/projects", { method: "POST", body: JSON.stringify(data) }),

  getProject: (id: string) => fetchApi<unknown>(`/api/projects/${id}`),

  updateProject: (id: string, data: Record<string, unknown>) =>
    fetchApi<unknown>(`/api/projects/${id}`, { method: "PATCH", body: JSON.stringify(data) }),

  deleteProject: (id: string) =>
    fetchApi<unknown>(`/api/projects/${id}`, { method: "DELETE" }),

  // Upload
  getPresignedUrl: (data: { fileName: string; contentType: string; purpose: string }) =>
    fetchApi<{ signedUrl: string; key: string; expiresIn: number }>(
      "/api/upload/presign",
      { method: "POST", body: JSON.stringify(data) }
    ),

  addTemplate: (projectId: string, s3Key: string) =>
    fetchApi<{ templateId: string; jobId: string }>(
      `/api/projects/${projectId}/template`,
      { method: "POST", body: JSON.stringify({ s3Key }) }
    ),

  addReference: (projectId: string, data: { s3Key: string; fileName: string; fileType: string; fileSize?: number }) =>
    fetchApi<unknown>(
      `/api/projects/${projectId}/references`,
      { method: "POST", body: JSON.stringify(data) }
    ),

  // Generation
  generate: (projectId: string, data: {
    prompt: string;
    numSlides: number;
    audienceType: string;
    modelId: string;
    engine?: "claude-code" | "claude-gemini" | "node-worker";
    chatImageKeys?: string[];
  }) =>
    fetchApi<{ jobId: string }>(
      `/api/projects/${projectId}/generate`,
      { method: "POST", body: JSON.stringify(data) }
    ),

  getJob: (jobId: string) => fetchApi<unknown>(`/api/jobs/${jobId}`),

  approveJob: (jobId: string, data: { approved: boolean; editedOutline?: unknown[]; feedback?: string }) =>
    fetchApi<unknown>(
      `/api/jobs/${jobId}/approve`,
      { method: "POST", body: JSON.stringify(data) }
    ),

  // LLM
  listModels: () => fetchApi<{ models: unknown[]; configuredProviders: string[]; isFreeTier: boolean }>("/api/llm/models"),

  createLLMConfig: (data: Record<string, unknown>) =>
    fetchApi<unknown>("/api/llm/configs", { method: "POST", body: JSON.stringify(data) }),

  deleteLLMConfig: (id: string) =>
    fetchApi<unknown>(`/api/llm/configs/${id}`, { method: "DELETE" }),

  // Integrations
  openInMicrosoft: (presentationId: string) =>
    fetchApi<{ editUrl: string }>(
      "/api/integrations/microsoft/open",
      { method: "POST", body: JSON.stringify({ presentationId }) }
    ),

  importToCanva: (presentationId: string) =>
    fetchApi<{ editUrl: string; designId: string }>(
      "/api/integrations/canva/import",
      { method: "POST", body: JSON.stringify({ presentationId }) }
    ),

  exportFromCanva: (presentationId: string, designId: string) =>
    fetchApi<{ presentationId: string; downloadUrl: string }>(
      "/api/integrations/canva/export",
      { method: "POST", body: JSON.stringify({ presentationId, designId }) }
    ),
};
