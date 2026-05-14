"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

// Notification kinds the UI knows how to render. Add new kinds here as we
// surface more background events (chat replies, export jobs, etc.).
export type NotificationKind =
  | "deck_ready"
  | "deck_failed"
  | "edit_ready"
  | "edit_failed";

export interface Notification {
  id: string;
  kind: NotificationKind;
  projectId: string;
  projectName?: string;
  jobId: string;
  // One-line summary shown in the dropdown row.
  title: string;
  // Longer message — shown on the toast and inside the dropdown row.
  body?: string;
  createdAt: number;
  read: boolean;
  // Optional href the row links to. Defaults to /projects/<projectId>.
  href?: string;
}

interface NotificationState {
  notifications: Notification[];

  // Add a notification. Dedupes by (jobId, kind) so refreshing the page
  // mid-completion doesn't double-push the same event.
  push: (n: Omit<Notification, "id" | "createdAt" | "read">) => string | null;

  markRead: (id: string) => void;
  markAllRead: () => void;
  clear: () => void;
  remove: (id: string) => void;

  // Selectors
  unreadCount: () => number;
}

function nid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export const useNotificationStore = create<NotificationState>()(
  persist(
    (set, get) => ({
      notifications: [],

      push: (n) => {
        // Dedupe by jobId + kind. Returns null when skipped so callers can
        // tell whether they need to fire a toast.
        const existing = get().notifications.find(
          (x) => x.jobId === n.jobId && x.kind === n.kind,
        );
        if (existing) return null;

        const note: Notification = {
          ...n,
          id: nid(),
          createdAt: Date.now(),
          read: false,
        };
        set((s) => ({
          // Cap at 30 — older notifications drop off the bottom.
          notifications: [note, ...s.notifications].slice(0, 30),
        }));
        return note.id;
      },

      markRead: (id) =>
        set((s) => ({
          notifications: s.notifications.map((n) =>
            n.id === id ? { ...n, read: true } : n,
          ),
        })),

      markAllRead: () =>
        set((s) => ({
          notifications: s.notifications.map((n) => ({ ...n, read: true })),
        })),

      clear: () => set({ notifications: [] }),

      remove: (id) =>
        set((s) => ({
          notifications: s.notifications.filter((n) => n.id !== id),
        })),

      unreadCount: () => get().notifications.filter((n) => !n.read).length,
    }),
    {
      name: "slideforge-notifications",
      // Drop notifications older than 7 days on hydrate — they're stale.
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        const week = 7 * 24 * 60 * 60 * 1000;
        state.notifications = state.notifications.filter(
          (n) => Date.now() - n.createdAt < week,
        );
      },
    },
  ),
);
