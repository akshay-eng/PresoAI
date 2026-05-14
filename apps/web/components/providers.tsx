"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionProvider } from "next-auth/react";
import { useState, type ReactNode } from "react";
import { Toaster } from "sonner";
import { JobsMonitor } from "@/components/notifications/jobs-monitor";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
            retry: 1,
          },
        },
      })
  );

  return (
    <SessionProvider>
      <QueryClientProvider client={queryClient}>
        {/* Background watcher — polls any in-flight job slot the user has
            across all open projects, fires a toast + persistent notification
            when one completes (suppressed if the user is already on that
            project page). */}
        <JobsMonitor />
        {children}
        <Toaster
          position="bottom-right"
          theme="dark"
          toastOptions={{
            style: {
              background: "#22252E",
              border: "1px solid #2F323D",
              color: "#EDEBE7",
            },
          }}
        />
      </QueryClientProvider>
    </SessionProvider>
  );
}
