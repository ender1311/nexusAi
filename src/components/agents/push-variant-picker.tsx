"use client";

import { useEffect, useState } from "react";
import { PushNotificationPreview } from "@/components/agents/push-notification-preview";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";
import type { VariantWithMessage } from "@/types/agent";

interface PushVariantPickerProps {
  selectedVariantIds: string[];
  category?: string;
  onToggle: (variant: VariantWithMessage) => void;
}

type FetchState =
  | { status: "loading" }
  | { status: "done"; variants: VariantWithMessage[]; fetchedCategory: string | undefined };

export function PushVariantPicker({ selectedVariantIds, category, onToggle }: PushVariantPickerProps) {
  const [state, setState] = useState<FetchState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    const url = category ? `/api/variants?category=${encodeURIComponent(category)}` : "/api/variants";
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<VariantWithMessage[]>;
      })
      .then((data) => {
        if (!cancelled) {
          setState({
            status: "done",
            variants: data.filter((v) => v.message.channel === "push"),
            fetchedCategory: category,
          });
        }
      })
      .catch(() => {
        if (!cancelled) setState({ status: "done", variants: [], fetchedCategory: category });
      });
    return () => { cancelled = true; };
  }, [category]);

  const loading = state.status === "loading" || (state.status === "done" && state.fetchedCategory !== category);
  const variants = state.status === "done" ? state.variants : [];

  if (loading) {
    return <p className="text-xs text-muted-foreground py-4 text-center">Loading approved variants…</p>;
  }

  if (variants.length === 0) {
    return (
      <p className="text-xs text-muted-foreground py-4 text-center">
        {category
          ? `No approved variants for "${category}". Run the seed script: bun run scripts/seed-push-copy-templates.ts`
          : "No approved push variants found. Run the seed script first."}
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
