"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  metadata?: {
    audienceType?: string;
    numSlides?: number;
    phase?: string;
    progress?: number;
    attachments?: string[];
    jobId?: string;
    outline?: unknown[];
    slides?: unknown[];
    engine?: string;
    error?: string;
    presentationId?: string;
    s3Key?: string;
    imageKeys?: string[];
    // Surgical-edit + intent-classifier additions
    mode?: "edit" | "generate";
    intent?: "generate" | "edit" | "clarify" | "decline" | "greeting";
    guardrail?: boolean;
    // Structured error from python-agent's classifier — billing/auth/rate
    // limit/etc. Lets the chat render an actionable card instead of dumping
    // a raw stack trace.
    errorDetails?: {
      code?: string;
      title?: string;
      message?: string;
      hint?: string;
      provider?: string | null;
      retryable?: boolean;
    };
  };
}

interface ProjectChat {
  messages: ChatMessage[];
  synced: boolean; // whether this chat has been synced from server
}

interface ChatStore {
  chats: Record<string, ProjectChat>;
  addMessage: (projectId: string, message: Omit<ChatMessage, "id" | "timestamp">) => string;
  updateLastAssistantMessage: (projectId: string, updates: Partial<ChatMessage>) => void;
  // Inline-edit a specific message — used by the "Edit this prompt" UX in
  // user bubbles. Updates content in place; server sync happens via the
  // existing syncToServer pattern.
  setMessageContent: (projectId: string, messageId: string, content: string) => void;
  getMessages: (projectId: string) => ChatMessage[];
  clearChat: (projectId: string) => void;
  loadFromServer: (projectId: string) => Promise<void>;
  syncToServer: (projectId: string, message: ChatMessage) => Promise<void>;
  markSynced: (projectId: string) => void;
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export const useChatStore = create<ChatStore>()(
  persist(
    (set, get) => ({
      chats: {},

      addMessage: (projectId, message) => {
        const newMsg: ChatMessage = {
          ...message,
          id: generateId(),
          timestamp: Date.now(),
        };
        set((state) => {
          const existing = state.chats[projectId] || { messages: [], synced: false };
          return {
            chats: {
              ...state.chats,
              [projectId]: {
                messages: [...existing.messages, newMsg],
                synced: existing.synced,
              },
            },
          };
        });

        // Fire-and-forget server sync
        get().syncToServer(projectId, newMsg).catch(() => {});

        return newMsg.id;
      },

      updateLastAssistantMessage: (projectId, updates) => {
        set((state) => {
          const existing = state.chats[projectId];
          if (!existing || existing.messages.length === 0) return state;

          const messages = [...existing.messages];
          for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i]!.role === "assistant") {
              messages[i] = { ...messages[i]!, ...updates };
              break;
            }
          }

          return {
            chats: {
              ...state.chats,
              [projectId]: { ...existing, messages },
            },
          };
        });
      },

      setMessageContent: (projectId, messageId, content) => {
        set((state) => {
          const existing = state.chats[projectId];
          if (!existing) return state;
          const messages = existing.messages.map((m) =>
            m.id === messageId ? { ...m, content } : m,
          );
          return {
            chats: {
              ...state.chats,
              [projectId]: { ...existing, messages },
            },
          };
        });
        // Mirror to server (best-effort). The PATCH endpoint will accept the
        // new content if present; chat-message route already supports POST
        // for new messages, PATCH for in-place edits.
        fetch(`/api/projects/${projectId}/chat/${messageId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        }).catch(() => { /* silent — local state is preserved */ });
      },

      getMessages: (projectId) => {
        return get().chats[projectId]?.messages || [];
      },

      clearChat: (projectId) => {
        set((state) => {
          const newChats = { ...state.chats };
          delete newChats[projectId];
          return { chats: newChats };
        });
        // Also clear on server
        fetch(`/api/projects/${projectId}/chat`, { method: "DELETE" }).catch(() => {});
      },

      loadFromServer: async (projectId) => {
        const existing = get().chats[projectId];
        // If we already have messages locally and haven't synced, merge
        if (existing?.synced) return;

        try {
          const res = await fetch(`/api/projects/${projectId}/chat`);
          if (!res.ok) return;

          const serverMessages: Array<{
            id: string;
            role: "user" | "assistant" | "system";
            content: string;
            metadata?: Record<string, unknown>;
            createdAt: string;
          }> = await res.json();

          if (serverMessages.length === 0 && existing?.messages.length) {
            // Local has data, server is empty — sync local to server
            for (const msg of existing.messages) {
              await get().syncToServer(projectId, msg);
            }
            set((state) => ({
              chats: {
                ...state.chats,
                [projectId]: { ...state.chats[projectId]!, synced: true },
              },
            }));
            return;
          }

          if (serverMessages.length > 0) {
            // Server has data — use it as source of truth
            const messages: ChatMessage[] = serverMessages.map((m) => ({
              id: m.id,
              role: m.role,
              content: m.content,
              timestamp: new Date(m.createdAt).getTime(),
              metadata: m.metadata as ChatMessage["metadata"],
            }));

            // Merge with any local-only messages that aren't on the server
            const serverIds = new Set(messages.map((m) => m.id));
            const localOnly = (existing?.messages || []).filter(
              (m) => !serverIds.has(m.id)
            );

            set((state) => ({
              chats: {
                ...state.chats,
                [projectId]: {
                  messages: [...messages, ...localOnly].sort(
                    (a, b) => a.timestamp - b.timestamp
                  ),
                  synced: true,
                },
              },
            }));
          }
        } catch {
          // Server unavailable — keep local state
        }
      },

      syncToServer: async (projectId, message) => {
        try {
          await fetch(`/api/projects/${projectId}/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              role: message.role,
              content: message.content,
              metadata: message.metadata || {},
            }),
          });
        } catch {
          // Silent fail — local state is preserved
        }
      },

      markSynced: (projectId) => {
        set((state) => {
          const existing = state.chats[projectId];
          if (!existing) return state;
          return {
            chats: {
              ...state.chats,
              [projectId]: { ...existing, synced: true },
            },
          };
        });
      },
    }),
    {
      name: "slideforge-chats",
    }
  )
);
