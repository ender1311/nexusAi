"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw } from "lucide-react";

export function ErrorFallback({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  useEffect(() => {
    console.error(error);
  }, [error]);

  const handleRetry = useCallback(() => {
    setIsPending(true);
    router.refresh();
    // Keep spinner visible for min 600ms so the user sees the reload,
    // then call reset() to clear the error boundary and show fresh content.
    setTimeout(() => {
      reset();
      setIsPending(false);
    }, 600);
  }, [router, reset]);

  return (
    <div className="flex flex-col items-center justify-center py-24 text-center gap-4">
      <p className="text-sm font-medium text-destructive">Something went wrong</p>
      <p className="text-xs text-muted-foreground">{error.message}</p>
      <Button size="sm" variant="outline" disabled={isPending} onClick={handleRetry}>
        {isPending ? (
          <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
        ) : (
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
        )}
        {isPending ? "Retrying…" : "Try again"}
      </Button>
    </div>
  );
}
