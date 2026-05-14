"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Bell, CheckCircle2, AlertCircle, Trash2, MailOpen, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useNotificationStore, type Notification } from "@/lib/stores/notification-store";

export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const notifications = useNotificationStore((s) => s.notifications);
  const markRead = useNotificationStore((s) => s.markRead);
  const markAllRead = useNotificationStore((s) => s.markAllRead);
  const remove = useNotificationStore((s) => s.remove);
  const clear = useNotificationStore((s) => s.clear);

  const unread = notifications.filter((n) => !n.read).length;

  // Close on outside click / Escape so it behaves like a real popover.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function openNotification(n: Notification) {
    markRead(n.id);
    if (n.href) router.push(n.href);
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "w-10 flex flex-col items-center gap-0.5 py-1.5 rounded-lg transition-colors relative",
          open ? "text-primary" : "text-muted-foreground/50 hover:text-foreground",
        )}
        title="Notifications"
      >
        <Bell className="h-[18px] w-[18px]" strokeWidth={open ? 2 : 1.5} />
        <span className="text-[9px] leading-tight font-medium">Inbox</span>
        {unread > 0 && (
          <span className="absolute -top-0.5 right-1 min-w-[14px] h-[14px] px-1 rounded-full bg-primary text-primary-foreground text-[9px] font-semibold flex items-center justify-center">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, x: -6, scale: 0.98 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: -6, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            // Anchored to the right of the sidebar — sidebar is 72px wide,
            // so we offset by that plus a small gap.
            className="fixed left-[80px] bottom-6 z-50 w-[340px] max-h-[480px] rounded-xl border border-border bg-card shadow-2xl overflow-hidden flex flex-col"
          >
            <header className="flex items-center justify-between px-3.5 py-2.5 border-b border-border/60">
              <div className="flex items-center gap-2">
                <Bell className="h-3.5 w-3.5 text-primary" />
                <p className="text-sm font-semibold">Notifications</p>
                {unread > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                    {unread} new
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                {unread > 0 && (
                  <button
                    onClick={markAllRead}
                    className="text-[10px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1 px-1.5 py-0.5"
                    title="Mark all read"
                  >
                    <MailOpen className="h-3 w-3" />
                  </button>
                )}
                {notifications.length > 0 && (
                  <button
                    onClick={clear}
                    className="text-[10px] text-muted-foreground hover:text-destructive transition-colors flex items-center gap-1 px-1.5 py-0.5"
                    title="Clear all"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </div>
            </header>

            <div className="flex-1 overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="px-4 py-10 text-center">
                  <Bell className="h-6 w-6 text-muted-foreground/30 mx-auto mb-1.5" />
                  <p className="text-xs font-medium">All caught up</p>
                  <p className="text-[10px] text-muted-foreground mt-1 max-w-[220px] mx-auto">
                    When a deck finishes generating in the background, you&apos;ll see it here.
                  </p>
                </div>
              ) : (
                <ul className="divide-y divide-border/40">
                  {notifications.map((n) => (
                    <NotificationRow
                      key={n.id}
                      notification={n}
                      onOpen={() => openNotification(n)}
                      onDismiss={() => remove(n.id)}
                    />
                  ))}
                </ul>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function NotificationRow({
  notification,
  onOpen,
  onDismiss,
}: {
  notification: Notification;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  const isError = notification.kind === "deck_failed" || notification.kind === "edit_failed";
  const Icon = isError ? AlertCircle : CheckCircle2;

  return (
    <li
      className={cn(
        "group relative px-3.5 py-2.5 hover:bg-muted/30 transition-colors cursor-pointer",
        !notification.read && "bg-primary/[0.03]",
      )}
      onClick={onOpen}
    >
      <div className="flex items-start gap-2.5">
        <div className={cn(
          "mt-0.5 h-6 w-6 rounded-full flex items-center justify-center shrink-0",
          isError ? "bg-rose-500/10 text-rose-500" : "bg-emerald-500/10 text-emerald-500",
        )}>
          <Icon className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-xs font-medium truncate">{notification.title}</p>
            {!notification.read && (
              <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
            )}
          </div>
          {notification.body && (
            <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">
              {notification.body}
            </p>
          )}
          <p className="text-[10px] text-muted-foreground/70 mt-1">
            {formatAgo(notification.createdAt)}
          </p>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDismiss();
          }}
          className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground/60 hover:text-foreground shrink-0 mt-0.5"
          title="Dismiss"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    </li>
  );
}

function formatAgo(ts: number): string {
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "yesterday" : `${d}d ago`;
}
