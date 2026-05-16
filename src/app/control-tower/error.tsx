"use client";
import { useEffect, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center py-24 text-center gap-4">
      <p className="text-sm font-medium text-destructive">Something went wrong</p>
      <p className="text-xs text-muted-foreground">{error.message}</p>
      <Button
        size="sm"
        variant="outline"
        disabled={isPending}
        onClick={() => startTransition(reset)}
      >
        {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Try again"}
      </Button>
    </div>
  );
}
