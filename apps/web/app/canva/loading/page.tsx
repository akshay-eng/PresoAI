"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

function CanvaLoading() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const presentationId = searchParams.get("presentationId");

  const [status, setStatus] = useState<"loading" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current || !presentationId) return;
    ran.current = true;

    async function doUpload() {
      try {
        const res = await fetch("/api/integrations/canva/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ presentationId }),
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || "Upload to Canva failed");
        }

        window.location.href = data.editUrl;
      } catch (err) {
        setErrorMsg((err as Error).message);
        setStatus("error");
      }
    }

    doUpload();
  }, [presentationId]);

  if (status === "error") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="max-w-sm w-full rounded-2xl border border-border bg-card p-8 text-center space-y-4">
          <div className="h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
            <AlertCircle className="h-6 w-6 text-destructive" />
          </div>
          <div>
            <h2 className="text-base font-semibold">Canva import failed</h2>
            <p className="text-sm text-muted-foreground mt-1">{errorMsg}</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => router.push("/dashboard")}>
            Back to dashboard
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="max-w-sm w-full rounded-2xl border border-border bg-card p-8 text-center space-y-5">
        <div className="h-14 w-14 rounded-2xl bg-[#7D2AE8] flex items-center justify-center mx-auto text-white text-2xl font-bold shadow-lg">
          C
        </div>
        <div>
          <h2 className="text-base font-semibold">Opening in Canva…</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Importing your presentation. This usually takes 5–15 seconds.
          </p>
        </div>
        <Loader2 className="h-6 w-6 animate-spin text-primary mx-auto" />
      </div>
    </div>
  );
}

export default function CanvaLoadingPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-background">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      }
    >
      <CanvaLoading />
    </Suspense>
  );
}
