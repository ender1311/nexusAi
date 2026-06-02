"use client";

import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { VariantWithMessage } from "@/types/agent";
import { PUSH_CATEGORIES } from "@/lib/push-categories";

// ─── Category / subcategory catalogue ─────────────────────────────────────────

const CATEGORIES = PUSH_CATEGORIES;

// ─── Types ────────────────────────────────────────────────────────────────────

type FetchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; variants: VariantWithMessage[]; fetchedCategory: string; fetchedSubcategory: string }
  | { status: "error"; message: string };

export type VariantPickerProps = {
  agentId: string;
  messageId: string;
  existingVariantCount: number;
  onSaved: () => void;
  onCancel: () => void;
};

// ─── Component ────────────────────────────────────────────────────────────────

export function VariantPicker({
  agentId,
  messageId,
  existingVariantCount,
  onSaved,
  onCancel,
}: VariantPickerProps) {
  const firstCategory = CATEGORIES[0];

  const [selectedCategory, setSelectedCategory] = useState<string>(firstCategory.value);
  const [selectedSubcategory, setSelectedSubcategory] = useState<string>(
    firstCategory.subcategories[0]?.value ?? "",
  );
  const [selectedVariantIds, setSelectedVariantIds] = useState<Set<string>>(new Set());
  const [fetchState, setFetchState] = useState<FetchState>({ status: "idle" });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Fetch approved variants whenever category or subcategory changes
  useEffect(() => {
    let cancelled = false;
    setFetchState({ status: "loading" });
    setSelectedVariantIds(new Set());

    const url = `/api/variants?category=${encodeURIComponent(selectedCategory)}&subcategory=${encodeURIComponent(selectedSubcategory)}`;

    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<VariantWithMessage[]>;
      })
      .then((data) => {
        if (!cancelled) {
          setFetchState({
            status: "done",
            variants: data,
            fetchedCategory: selectedCategory,
            fetchedSubcategory: selectedSubcategory,
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFetchState({ status: "error", message: "Failed to load variants." });
        }
      });

    return () => { cancelled = true; };
  }, [selectedCategory, selectedSubcategory]);

  function handleCategoryClick(categoryValue: string) {
    if (categoryValue === selectedCategory) return;
    const cat = CATEGORIES.find((c) => c.value === categoryValue);
    if (!cat) return;
    setSelectedCategory(categoryValue);
    setSelectedSubcategory(cat.subcategories[0]?.value ?? "");
  }

  function handleVariantToggle(variantId: string) {
    setSelectedVariantIds((prev) => {
      const next = new Set(prev);
      if (next.has(variantId)) next.delete(variantId);
      else next.add(variantId);
      return next;
    });
  }

  async function handleSave() {
    if (saving) return;
    const variants = fetchState.status === "done"
      ? fetchState.variants.filter((v) => selectedVariantIds.has(v.id))
      : [];
    if (variants.length === 0) return;

    setSaving(true);
    setSaveError(null);

    try {
      // Add each selected variant sequentially to preserve name numbering
      for (let i = 0; i < variants.length; i++) {
        const v = variants[i];
        const res = await fetch(`/api/agents/${agentId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messageId,
            variant: {
              name: `V${existingVariantCount + i + 1}`,
              body: v.body,
              title: v.title ?? null,
              deeplink: v.deeplink ?? null,
              sourceTemplateId: v.id,
            },
          }),
        });
        if (!res.ok) {
          const json = (await res.json()) as { error?: string };
          throw new Error(json.error ?? `HTTP ${res.status}`);
        }
      }
      onSaved();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to add variant.");
    } finally {
      setSaving(false);
    }
  }

  const currentCategory = CATEGORIES.find((c) => c.value === selectedCategory) ?? CATEGORIES[0];
  const variants = fetchState.status === "done" ? fetchState.variants : [];
  const isLoading =
    fetchState.status === "loading" ||
    (fetchState.status === "done" &&
      (fetchState.fetchedCategory !== selectedCategory ||
        fetchState.fetchedSubcategory !== selectedSubcategory));
  const selectedCount = selectedVariantIds.size;

  return (
    <div className="space-y-4">
      {/* Category tabs */}
      <div>
        <p className="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">Category</p>
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((cat) => (
            <Button
              key={cat.value}
              variant={cat.value === selectedCategory ? "default" : "outline"}
              size="sm"
              onClick={() => handleCategoryClick(cat.value)}
            >
              {cat.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Subcategory pills */}
      {currentCategory.subcategories.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">Sub-goal</p>
          <div className="flex flex-wrap gap-1.5">
            {currentCategory.subcategories.map((sub) => (
              <Button
                key={sub.value}
                variant={sub.value === selectedSubcategory ? "default" : "outline"}
                size="xs"
                onClick={() => setSelectedSubcategory(sub.value)}
              >
                {sub.label}
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* Approved variant list */}
      <div>
        {isLoading && (
          <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-xs">Loading approved variants…</span>
          </div>
        )}

        {!isLoading && fetchState.status === "error" && (
          <p className="py-6 text-center text-xs text-destructive">{fetchState.message}</p>
        )}

        {!isLoading && fetchState.status === "done" && variants.length === 0 && (
          <p className="py-6 text-center text-xs text-muted-foreground">
            No approved variants found for this category.
          </p>
        )}

        {!isLoading && fetchState.status === "done" && variants.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {variants.map((v) => {
              const selected = selectedVariantIds.has(v.id);
              return (
                <div
                  key={v.id}
                  onClick={() => handleVariantToggle(v.id)}
                  className={cn(
                    "relative cursor-pointer rounded-lg border p-3 transition-colors",
                    selected
                      ? "border-primary bg-primary/5 ring-1 ring-primary"
                      : "border-border bg-background hover:border-primary/40",
                  )}
                >
                  {selected && (
                    <div className="absolute right-2 top-2 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <Check className="h-2.5 w-2.5" />
                    </div>
                  )}
                  <p className="pr-5 text-xs font-semibold leading-snug mb-0.5">{v.name}</p>
                  {v.title && (
                    <p className="text-xs font-medium leading-snug text-foreground/80 mb-0.5">{v.title}</p>
                  )}
                  <p className="text-xs leading-snug text-muted-foreground line-clamp-2">{v.body}</p>
                  {v.deeplink && (
                    <p className="text-[10px] font-mono text-muted-foreground/60 mt-1 truncate">{v.deeplink}</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {saveError && <p className="text-sm text-destructive">{saveError}</p>}

      {/* Footer */}
      <div className="flex items-center justify-between border-t pt-3">
        <span className="text-sm text-muted-foreground">
          {selectedCount === 0
            ? "Select a variant to add"
            : `${selectedCount} variant${selectedCount === 1 ? "" : "s"} selected`}
        </span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" disabled={selectedCount === 0 || saving} onClick={handleSave}>
            {saving ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                Adding…
              </>
            ) : (
              `Add Variant${selectedCount > 1 ? "s" : ""}`
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
