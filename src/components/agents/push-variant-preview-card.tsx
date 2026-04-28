"use client";

import { Badge } from "@/components/ui/badge";
import { PushNotificationPreview } from "@/components/agents/push-notification-preview";
import { cn } from "@/lib/utils";

interface VariantRow {
  id: string;
  name: string;
  title: string | null;
  body: string | null;
  deeplink: string | null;
  status: string;
  brazeVariantId: string | null;
}

interface PushVariantPreviewCardProps {
  variant: VariantRow;
  channel: string;
}

export function PushVariantPreviewCard({ variant, channel }: PushVariantPreviewCardProps) {
  return (
    <div className="rounded-lg border p-4 space-y-3">
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
            variant.status === "active" ? "text-green-700 bg-green-50" : "text-yellow-700 bg-yellow-50"
          )}
        >
          {variant.status}
        </Badge>
      </div>

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
