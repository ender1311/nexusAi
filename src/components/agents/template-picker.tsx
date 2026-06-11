"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import type { VariantWithMessage } from "@/types/agent";
import {
  GENERIC_BIBLE_DEEPLINK,
  resolveSpecificVerseDeeplink,
  type SpecificVerseDeeplinkMode,
} from "@/lib/push-deeplinks";
import { PUSH_CATEGORIES } from "@/lib/push-categories";
import { VERSE_IMAGE_SENTINEL } from "@/lib/verse-image";

// ─── Category / subcategory catalogue ────────────────────────────────────────

const CATEGORIES = PUSH_CATEGORIES;

// ─── Types ────────────────────────────────────────────────────────────────────

type FetchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; variants: VariantWithMessage[]; fetchedCategory: string; fetchedSubcategory: string }
  | { status: "error"; message: string };

type DraftMessage = {
  name: string;
  channel: "push";
  variants: Array<{ name: string; title?: string; body: string; deeplink?: string; iconImageUrl?: string; sourceTemplateId: string }>;
};

export type TemplatePickerProps =
  | { agentId: string; onSaved: () => void; onAddToDraft?: never }
  | { onAddToDraft: (msg: DraftMessage) => void; agentId?: never; onSaved?: never };

// Imperative handle (draft mode only): lets a parent commit the currently
// selected-but-unsaved variants without the user clicking "Add Message".
export type TemplatePickerHandle = {
  /** Commits the pending selection to the draft. Returns true if anything was committed. */
  commitPending: () => boolean;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildMessageName(category: string, subcategory: string): string {
  const cat = CATEGORIES.find((c) => c.value === category);
  if (!cat) return "";
  if (cat.subcategories.length === 0) return cat.label;
  const sub = cat.subcategories.find((s) => s.value === subcategory);
  if (!sub) return "";
  return `${cat.label} — ${sub.label}`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export const TemplatePicker = forwardRef<TemplatePickerHandle, TemplatePickerProps>(
  function TemplatePicker(props, ref) {
  const firstCategory = CATEGORIES[0];

  const [selectedCategory, setSelectedCategory] = useState<string>(firstCategory.value);
  const [selectedSubcategory, setSelectedSubcategory] = useState<string>(
    firstCategory.subcategories[0]?.value ?? "",
  );
  const [selectedVariantIds, setSelectedVariantIds] = useState<Set<string>>(new Set());
  const [messageName, setMessageName] = useState<string>(
    buildMessageName(firstCategory.value, firstCategory.subcategories[0]?.value ?? ""),
  );
  const [nameManuallyEdited, setNameManuallyEdited] = useState(false);
  const [fetchState, setFetchState] = useState<FetchState>({ status: "idle" });
  const [autoMode, setAutoMode] = useState(false);
  const [autoCount, setAutoCount] = useState(2);
  const [specificVerseDeeplinkMode, setSpecificVerseDeeplinkMode] =
    useState<SpecificVerseDeeplinkMode>("specific");
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

  // Auto-pick N random variants whenever auto mode is on and variants are available
  useEffect(() => {
    if (!autoMode || fetchState.status !== "done") return;
    const available = fetchState.variants;
    const count = Math.min(autoCount, available.length);
    if (count < 2) return;
    const shuffled = [...available].sort(() => Math.random() - 0.5);
    setSelectedVariantIds(new Set(shuffled.slice(0, count).map((v) => v.id)));
  }, [autoMode, autoCount, fetchState]);

  function handleAutoModeToggle(on: boolean) {
    setAutoMode(on);
    if (!on) setSelectedVariantIds(new Set());
  }

  function handleCategoryClick(categoryValue: string) {
    if (categoryValue === selectedCategory) return;
    const cat = CATEGORIES.find((c) => c.value === categoryValue);
    if (!cat) return;
    setSelectedCategory(categoryValue);
    setSelectedSubcategory(cat.subcategories[0]?.value ?? "");
  }

  function handleSubcategoryClick(subcategoryValue: string) {
    setSelectedSubcategory(subcategoryValue);
    if (subcategoryValue === "specific-verse") {
      setSpecificVerseDeeplinkMode("specific");
    }
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

  const buildPayload = useCallback((): DraftMessage | null => {
    const selectedVariants =
      fetchState.status === "done"
        ? fetchState.variants.filter((v) => selectedVariantIds.has(v.id))
        : [];
    if (selectedVariants.length === 0 || messageName.trim().length === 0) return null;

    return {
      name: messageName.trim(),
      channel: "push",
      variants: selectedVariants.map((v) => ({
        name: v.name,
        title: v.title ?? undefined,
        body: v.body,
        deeplink: selectedSubcategory === "specific-verse"
          ? resolveSpecificVerseDeeplink(v.deeplink, specificVerseDeeplinkMode)
          : (v.deeplink ?? undefined),
        iconImageUrl: v.iconImageUrl ?? undefined,
        sourceTemplateId: v.id,
      })),
    };
  }, [fetchState, selectedVariantIds, messageName, selectedSubcategory, specificVerseDeeplinkMode]);

  // Draft mode (wizard): commit the current selection to parent state, reset for next message.
  const commitDraft = useCallback((): boolean => {
    const onAddToDraft = "onAddToDraft" in props ? props.onAddToDraft : undefined;
    if (!onAddToDraft) return false;
    const payload = buildPayload();
    if (!payload) return false;
    onAddToDraft(payload);
    setSelectedVariantIds(new Set());
    setNameManuallyEdited(false);
    return true;
  }, [props, buildPayload]);

  // Lets the wizard auto-commit picked verses when advancing, even if the user
  // never clicked the inner "Add Message" button.
  useImperativeHandle(ref, () => ({ commitPending: commitDraft }), [commitDraft]);

  async function handleSave() {
    if (saving) return;

    // Draft mode (wizard): add to parent state, reset for next message
    if ("onAddToDraft" in props && props.onAddToDraft) {
      commitDraft();
      return;
    }

    const payload = buildPayload();
    if (!payload) return;

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
      {currentCategory.subcategories.length > 0 && (
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
      )}

      {/* Deeplink Version toggle — specific-verse only */}
      {selectedSubcategory === "specific-verse" && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Deeplink Version
          </p>
          <div className="flex rounded-md border overflow-hidden text-xs">
            <button
              type="button"
              className={cn(
                "px-3 py-1.5 font-medium transition-colors flex-1",
                specificVerseDeeplinkMode === "generic"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => setSpecificVerseDeeplinkMode("generic")}
            >
              Generic
            </button>
            <button
              type="button"
              className={cn(
                "px-3 py-1.5 font-medium transition-colors border-l flex-1",
                specificVerseDeeplinkMode === "specific"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => setSpecificVerseDeeplinkMode("specific")}
            >
              Specific Verse
            </button>
          </div>
          <p className="text-xs font-mono text-muted-foreground">
            {specificVerseDeeplinkMode === "generic"
              ? GENERIC_BIBLE_DEEPLINK
              : "youversion://bible?reference=<verse>"}
          </p>
        </div>
      )}

      {/* Auto-pick controls */}
      {!isLoading && fetchState.status === "done" && variants.length >= 2 && (
        <div className="flex items-center gap-3 border-t pt-3">
          <div className="flex rounded-md border overflow-hidden text-xs shrink-0">
            <button
              type="button"
              className={cn(
                "px-3 py-1.5 font-medium transition-colors",
                !autoMode ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => handleAutoModeToggle(false)}
            >
              I&apos;ll pick
            </button>
            <button
              type="button"
              className={cn(
                "px-3 py-1.5 font-medium transition-colors border-l",
                autoMode ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => handleAutoModeToggle(true)}
            >
              Pick for me
            </button>
          </div>
          {autoMode && (
            <>
              <span className="text-xs text-muted-foreground shrink-0">Variants:</span>
              <Slider
                min={2}
                max={variants.length}
                step={1}
                value={[Math.min(autoCount, variants.length)]}
                onValueChange={(v) => setAutoCount(Array.isArray(v) ? v[0] : v)}
                className="flex-1"
              />
              <span className="text-xs font-semibold tabular-nums w-6 text-right shrink-0">
                {Math.min(autoCount, variants.length)}
              </span>
            </>
          )}
        </div>
      )}

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
                  onClick={() => !autoMode && handleVariantToggle(v.id)}
                  className={cn(
                    "relative rounded-lg border p-2.5 transition-colors",
                    autoMode ? "cursor-default" : "cursor-pointer",
                    selected
                      ? "border-primary bg-primary/5 ring-1 ring-primary"
                      : autoMode
                        ? "border-border bg-background"
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
                  {v.iconImageUrl === VERSE_IMAGE_SENTINEL && (
                    <p className="text-xs text-muted-foreground">+ today&apos;s verse image</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
});
