"use client";

import { useEffect, useState } from "react";
import { PushNotificationPreview } from "@/components/agents/push-notification-preview";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

interface VariantOption {
  id: string;
  name: string;
  title: string | null;
  body: string;
  deeplink: string | null;
  cta: string | null;
  message: { channel: string; name: string };
}

interface PushVariantPickerProps {
  selectedVariantIds: string[];
  onToggle: (variant: VariantOption) => void;
}

export function PushVariantPicker({ selectedVariantIds, onToggle }: PushVariantPickerProps) {
  const [variants, setVariants] = useState<VariantOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/variants")
      .then((r) => r.json())
      .then((data: VariantOption[]) => {
        setVariants(data.filter((v) => v.message.channel === "push"));
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <p className="text-xs text-muted-foreground py-4 text-center">Loading approved variants…</p>;
  }

  if (variants.length === 0) {
    return (
      <p className="text-xs text-muted-foreground py-4 text-center">
        No approved push variants found. Run the seed script first.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {variants.map((v) => {
        const selected = selectedVariantIds.includes(v.id);
        return (
          <button
            key={v.id}
            type="button"
            onClick={() => onToggle(v)}
            className={cn(
              "w-full text-left border rounded-lg p-3 transition-colors hover:border-primary/50",
              selected ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border bg-background"
            )}
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <div>
                <p className="text-xs font-semibold">{v.name}</p>
                <p className="text-xs text-muted-foreground">{v.message.name}</p>
              </div>
              {selected && <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />}
            </div>
            <div className="bg-gray-100 rounded-xl p-3 flex justify-center">
              <PushNotificationPreview
                title={v.title ?? undefined}
                body={v.body}
                deeplink={v.deeplink ?? undefined}
              />
            </div>
          </button>
        );
      })}
    </div>
  );
}
