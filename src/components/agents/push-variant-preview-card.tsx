"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { PushNotificationPreview } from "@/components/agents/push-notification-preview";
import { cn } from "@/lib/utils";
import { Flame } from "lucide-react";

interface VariantRow {
  id: string;
  name: string;
  title: string | null;
  body: string | null;
  deeplink: string | null;
  status: string;
  brazeVariantId: string | null;
  warmupUntil: Date | string | null;
}

interface PushVariantPreviewCardProps {
  variant: VariantRow;
  channel: string;
}

export function PushVariantPreviewCard({ variant, channel }: PushVariantPreviewCardProps) {
  const [warmupUntil, setWarmupUntil] = useState<Date | null>(
    variant.warmupUntil ? new Date(variant.warmupUntil) : null,
  );
  const [saving, setSaving] = useState(false);

  const isInWarmup = warmupUntil !== null && warmupUntil > new Date();

  async function handleWarmupChange(value: string) {
    const newDate = value ? new Date(value) : null;
    setSaving(true);
    try {
      await fetch(`/api/variants/${variant.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ warmupUntil: newDate?.toISOString() ?? null }),
      });
      setWarmupUntil(newDate);
    } catch {
      // silently fail — user sees no state change
    } finally {
      setSaving(false);
    }
  }

  function toDateInputValue(d: Date | null): string {
    if (!d) return "";
    return d.toISOString().slice(0, 10);
  }

  return (
    <div className="rounded-lg border p-4 space-y-3">
      {/* Header row: name + brazeVariantId + status badge */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{variant.name}</span>
          {variant.brazeVariantId && (
            <span className="text-xs font-mono text-muted-foreground">
              {variant.brazeVariantId}
            </span>
          )}
        </div>
        <Badge
          variant="outline"
          className={cn(
            "text-xs",
            variant.status === "active" ? "text-green-700 bg-green-50 dark:text-green-400 dark:bg-green-900/30" : "text-yellow-700 bg-yellow-50 dark:text-yellow-400 dark:bg-yellow-900/30"
          )}
        >
          {variant.status}
        </Badge>
      </div>

      {/* Warmup row */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <Flame className={cn("h-3.5 w-3.5", isInWarmup ? "text-amber-500" : "text-muted-foreground/40")} />
          <span className="text-xs text-muted-foreground">Warmup until</span>
        </div>
        <input
          type="date"
          value={toDateInputValue(warmupUntil)}
          onChange={(e) => handleWarmupChange(e.target.value)}
          disabled={saving}
          className="rounded border bg-background px-2 py-0.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50"
        />
        {warmupUntil && (
          <button
            onClick={() => handleWarmupChange("")}
            disabled={saving}
            className="text-xs text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
          >
            Clear
          </button>
        )}
        {isInWarmup && (
          <Badge variant="outline" className="text-xs text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-400 dark:bg-amber-900/30 dark:border-amber-800">
            active
          </Badge>
        )}
      </div>

      {/* Channel-specific content */}
      {channel === "push" && (
        <PushNotificationPreview
          title={variant.title}
          body={variant.body ?? ""}
          deeplink={variant.deeplink}
        />
      )}

      {channel !== "push" && (
        <div className="space-y-1">
          {variant.title && (
            <p className="text-xs font-medium text-muted-foreground">Subject: {variant.title}</p>
          )}
          <p className="text-sm text-muted-foreground">{variant.body}</p>
        </div>
      )}
    </div>
  );
}
