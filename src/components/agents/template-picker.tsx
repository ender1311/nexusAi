"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { VariantWithMessage } from "@/types/agent";

// ─── Category / subcategory catalogue ────────────────────────────────────────

type Subcategory = { value: string; label: string };
type Category = { value: string; label: string; subcategories: Subcategory[] };

const CATEGORIES: Category[] = [
  {
    value: "reader",
    label: "Reader",
    subcategories: [
      { value: "open-bible",     label: "Open Bible" },
      { value: "specific-verse", label: "Specific Verse" },
      { value: "audio-bible",    label: "Audio Bible" },
    ],
  },
  {
    value: "plans",
    label: "Plans",
    subcategories: [
      { value: "find-plans",  label: "Find Plans" },
      { value: "my-plans",    label: "My Plans" },
      { value: "saved-plans", label: "Saved Plans" },
    ],
  },
  {
    value: "votd",
    label: "VOTD",
    subcategories: [
      { value: "votd-page", label: "Verse of the Day" },
    ],
  },
  {
    value: "guided-scripture",
    label: "Guided Scripture",
    subcategories: [
      { value: "todays-story", label: "Today's Story" },
    ],
  },
  {
    value: "guided-prayer",
    label: "Guided Prayer",
    subcategories: [
      { value: "prayer-list",    label: "Prayer List" },
      { value: "guided-prayer",  label: "Guided Prayer" },
    ],
  },
];

// ─── Types ────────────────────────────────────────────────────────────────────

type FetchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; variants: VariantWithMessage[]; fetchedCategory: string; fetchedSubcategory: string }
  | { status: "error"; message: string };

type DraftMessage = {
  name: string;
  channel: "push";
  variants: Array<{ name: string; title?: string; body: string; deeplink?: string; sourceTemplateId: string }>;
};

export type TemplatePickerProps =
  | { agentId: string; onSaved: () => void; onAddToDraft?: never }
  | { onAddToDraft: (msg: DraftMessage) => void; agentId?: never; onSaved?: never };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildMessageName(category: string, subcategory: string): string {
  const cat = CATEGORIES.find((c) => c.value === category);
  const sub = cat?.subcategories.find((s) => s.value === subcategory);
  if (!cat || !sub) return "";
  return `${cat.label} — ${sub.label}`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function TemplatePicker(props: TemplatePickerProps) {
  const firstCategory = CATEGORIES[0];
  const firstSubcategory = firstCategory.subcategories[0];

  const [selectedCategory, setSelectedCategory] = useState<string>(firstCategory.value);
  const [selectedSubcategory, setSelectedSubcategory] = useState<string>(firstSubcategory.value);
  const [selectedVariantIds, setSelectedVariantIds] = useState<Set<string>>(new Set());
  const [messageName, setMessageName] = useState<string>(
    buildMessageName(firstCategory.value, firstSubcategory.value),
  );
  const [nameManuallyEdited, setNameManuallyEdited] = useState(false);
  const [fetchState, setFetchState] = useState<FetchState>({ status: "idle" });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Auto-suggest name when category/subcategory changes (unless user has overridden it)
  useEffect(() => {
    if (!nameManuallyEdited) {
      setMessageName(buildMessageName(selectedCategory, selectedSubcategory));
    }
  }, [selectedCategory, selectedSubcategory, nameManuallyEdited]);

  // Fetch variants whenever category or subcategory changes
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

    return () => {
      cancelled = true;
    };
  }, [selectedCategory, selectedSubcategory]);

  function handleCategoryClick(categoryValue: string) {
    if (categoryValue === selectedCategory) return;
    const cat = CATEGORIES.find((c) => c.value === categoryValue);
    if (!cat) return;
    setSelectedCategory(categoryValue);
    setSelectedSubcategory(cat.subcategories[0].value);
  }

  function handleSubcategoryClick(subcategoryValue: string) {
    setSelectedSubcategory(subcategoryValue);
  }

  function handleVariantToggle(variantId: string) {
    setSelectedVariantIds((prev) => {
      const next = new Set(prev);
      if (next.has(variantId)) {
        next.delete(variantId);
      } else {
        next.add(variantId);
      }
      return next;
    });
  }

  async function handleSave() {
    if (saving) return;

    const selectedVariants =
      fetchState.status === "done"
        ? fetchState.variants.filter((v) => selectedVariantIds.has(v.id))
        : [];

    const payload: DraftMessage = {
      name: messageName.trim(),
      channel: "push",
      variants: selectedVariants.map((v) => ({
        name: v.name,
        title: v.title ?? undefined,
        body: v.body,
        deeplink: v.deeplink ?? undefined,
        sourceTemplateId: v.id,
      })),
    };

    // Draft mode (wizard): add to parent state, reset for next message
    if (props.onAddToDraft) {
      props.onAddToDraft(payload);
      setSelectedVariantIds(new Set());
      setNameManuallyEdited(false);
      return;
    }

    // Existing-agent mode: POST to the API
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/agents/${props.agentId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
      props.onSaved();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save message.");
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
  const canSave = selectedCount > 0 && messageName.trim().length > 0 && !saving;

  return (
    <div className="space-y-4">
      {/* Message name */}
      <div>
        <label className="mb-1.5 block text-sm font-medium">Message name</label>
        <Input
          value={messageName}
          onChange={(e) => {
            setMessageName(e.target.value);
            setNameManuallyEdited(true);
          }}
          placeholder="e.g. Plans — My Plans"
        />
      </div>

      {/* Category tabs */}
      <div>
        <p className="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Category
        </p>
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
      <div>
        <p className="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Sub-goal
        </p>
        <div className="flex flex-wrap gap-1.5">
          {currentCategory.subcategories.map((sub) => (
            <Button
              key={sub.value}
              variant={sub.value === selectedSubcategory ? "default" : "outline"}
              size="xs"
              onClick={() => handleSubcategoryClick(sub.value)}
            >
              {sub.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Toolbar: count + save button */}
      <div className="flex items-center justify-between border-t pt-3">
        <span className="text-sm text-muted-foreground">
          {selectedCount === 0
            ? "No variants selected"
            : `${selectedCount} variant${selectedCount === 1 ? "" : "s"} selected`}
        </span>
        <Button size="sm" disabled={!canSave} onClick={handleSave}>
          {saving ? "Adding…" : props.onAddToDraft ? "Add Message" : "Save Message"}
        </Button>
      </div>

      {/* Error message */}
      {saveError && (
        <p className="text-sm text-destructive">{saveError}</p>
      )}

      {/* Variant grid */}
      <div>
        {isLoading && (
          <p className="py-6 text-center text-xs text-muted-foreground">Loading variants…</p>
        )}

        {!isLoading && fetchState.status === "error" && (
          <p className="py-6 text-center text-xs text-destructive">{fetchState.message}</p>
        )}

        {!isLoading && fetchState.status === "done" && variants.length === 0 && (
          <p className="py-6 text-center text-xs text-muted-foreground">
            No approved variants found for this category and sub-goal.
          </p>
        )}

        {!isLoading && fetchState.status === "done" && variants.length > 0 && (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {variants.map((v) => {
              const selected = selectedVariantIds.has(v.id);
              return (
                <div
                  key={v.id}
                  onClick={() => handleVariantToggle(v.id)}
                  className={cn(
                    "relative cursor-pointer rounded-lg border p-2.5 transition-colors",
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
                  <p className="mb-0.5 pr-5 text-xs font-semibold leading-snug">{v.name}</p>
                  <p className="text-xs leading-snug text-muted-foreground line-clamp-1">
                    {v.body}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
