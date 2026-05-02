"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Lock, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function AdminLoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Login failed");
      } else {
        router.replace("/admin");
        router.refresh();
      }
    } catch (err) {
      setError((err as Error).message);
    }
    setSubmitting(false);
  }

  return (
    <div className="min-h-screen grid place-items-center bg-muted/20 px-4">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="w-full max-w-sm rounded-2xl border border-border bg-card shadow-lg p-7"
      >
        <div className="flex items-center gap-2 mb-1">
          <div className="h-8 w-8 rounded-lg bg-primary/10 grid place-items-center">
            <Lock className="h-4 w-4 text-primary" />
          </div>
          <p className="text-[11px] font-semibold text-primary uppercase tracking-wider">Admin</p>
        </div>
        <h1 className="text-xl font-bold tracking-tight">Sign in to dashboard</h1>
        <p className="text-xs text-muted-foreground mt-1 mb-5">
          Restricted area — analytics and user controls.
        </p>

        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Username</label>
            <Input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              autoComplete="username"
              placeholder="admin"
              className="mt-1"
            />
          </div>
          <div>
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Password</label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              placeholder="••••••••"
              className="mt-1"
            />
          </div>
          {error && (
            <p className="text-xs text-destructive bg-destructive/10 rounded-md px-2.5 py-1.5">
              {error}
            </p>
          )}
          <Button
            type="submit"
            className="w-full"
            disabled={!username || !password || submitting}
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Sign in"}
          </Button>
        </form>
      </motion.div>
    </div>
  );
}
