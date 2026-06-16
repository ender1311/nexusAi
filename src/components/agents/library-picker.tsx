"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

// Channels backed by a pre-built content library (everything except push, which
// has its own goal/sub-goal taxonomy via TemplatePicker).
export type LibraryChannel = "email" | "in-app" | "modal-iam" | "content-card";

type LibraryConfig = { apiPath: string; label: string; snippet: (v: LibraryVariant) => string };

const LIBRARY_CONFIG: Record<LibraryChannel, LibraryConfig> = {
  email: { apiPath: "/api/email-library", label: "Email", snippet: (v) => v.subject || v.body },
  "in-app": { apiPath: "/api/slideup-library", label: "In-App", snippet: (v) => v.title || v.body },
  "modal-iam": { apiPath: "/api/modal-iam-library", label: "Modal", snippet: (v) => v.title || v.body },
  "content-card": { apiPath: "/api/content-card-library", label: "Content Card", snippet: (v) => v.title || v.body },
};

// A library variant as returned by the *-library GET endpoints (grouped shape).
// Channels populate different subsets of fields; all are optional here.
export type LibraryVariant = {
  id: string;
  name: string;
  body: string;
  title?: string | null;
  subject?: string | null;
  cta?: string | null;
  deeplink?: string | null;
  iconImageUrl?: string | null;
  category?: string | null;
  subcategory?: string | null;
};

type LibraryGroup = { category: string; subcategory: string | null; variants: LibraryVariant[] };

// Shape committed back to the wizard / settings editor. Mirrors the fields the
// agent message-create API accepts; sourceTemplateId links the clone to its
// library origin so template-sync keeps it fresh.
export type LibraryDraftMessage = {
  name: string;
  channel: LibraryChannel;
  variants: Array<{
    name: string;
    title?: string;
    subject?: string;
    body: string;
    cta?: string;
    deeplink?: string;
    iconImageUrl?: string;
    sourceTemplateId: string;
  }>;
};

export type LibraryPickerProps =
  | { channel: LibraryChannel; agentId: string; onSaved: () => void; onAddToDraft?: never }
  | { channel: LibraryChannel; onAddToDraft: (msg: LibraryDraftMessage) => void; agentId?: never; onSaved?: never };

export type LibraryPickerHandle = {
  /** Commits the pending selection to the draft. Returns true if anything was committed. */
  commitPending: () => boolean;
};

type FetchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; groups: LibraryGroup[] }
  | { status: "error"; message: string };

/** Humanize a slug ("recurring-ask" / "guided_prayer") → "Recurring Ask". */
function humanize(slug: string | null | undefined): string {
  if (!slug) return "General";
  return slug
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function buildMessageName(channelLabel: string, category: string, subcategory: string | null): string {
  const cat = humanize(category);
  const sub = subcategory ? humanize(subcategory) : null;
  return sub ? `${channelLabel} — ${cat} · ${sub}` : `${channelLabel} — ${cat}`;
}

export const LibraryPicker = forwardRef<LibraryPickerHandle, LibraryPickerProps>(
  function LibraryPicker(props, ref) {
    const { channel } = props;
    const config = LIBRARY_CONFIG[channel];

    const [fetchState, setFetchState] = useState<FetchState>({ status: "idle" });
    const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
    const [selectedSubcategory, setSelectedSubcategory] = useState<string | null>(null);
    const [selectedVariantIds, setSelectedVariantIds] = useState<Set<string>>(new Set());
    const [messageName, setMessageName] = useState("");
    const [nameManuallyEdited, setNameManuallyEdited] = useState(false);
    const [autoMode, setAutoMode] = useState(false);
    const [autoCount, setAutoCount] = useState(2);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);

    // Fetch the whole library once (grouped, no filters) when the channel changes.
    useEffect(() => {
      let cancelled = false;
      setFetchState({ status: "loading" });
      setSelectedVariantIds(new Set());
      setSelectedCategory(null);
      setSelectedSubcategory(null);
      fetch(config.apiPath)
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json() as Promise<{ data: LibraryGroup[] }>;
        })
        .then((json) => {
          if (cancelled) return;
          const groups = json.data ?? [];
          setFetchState({ status: "done", groups });
          const first = groups[0];
          if (first) {
            setSelectedCategory(first.category);
            setSelectedSubcategory(first.subcategory);
          }
        })
        .catch(() => {
          if (!cancelled) setFetchState({ status: "error", message: "Failed to load library." });
        });
      return () => {
        cancelled = true;
      };
    }, [config.apiPath]);

    const groups = fetchState.status === "done" ? fetchState.groups : [];

    // Distinct categories (preserve API order).
    const categories = useMemo(() => {
      const seen: string[] = [];
      for (const g of groups) if (!seen.includes(g.category)) seen.push(g.category);
      return seen;
    }, [groups]);

    // Subcategories within the selected category.
    const subcategories = useMemo(
      () =>
        groups
          .filter((g) => g.category === selectedCategory)
          .map((g) => g.subcategory),
      [groups, selectedCategory],
    );

    const activeGroup = useMemo(
      () =>
        groups.find(
          (g) => g.category === selectedCategory && g.subcategory === selectedSubcategory,
        ) ?? null,
      [groups, selectedCategory, selectedSubcategory],
    );
    const variants = activeGroup?.variants ?? [];

    // Auto-suggest the message name from the selected category/subcategory.
    useEffect(() => {
      if (!nameManuallyEdited && selectedCategory) {
        setMessageName(buildMessageName(config.label, selectedCategory, selectedSubcategory));
      }
    }, [config.label, selectedCategory, selectedSubcategory, nameManuallyEdited]);

    // Auto-pick N variants when auto-mode is on.
    useEffect(() => {
      if (!autoMode) return;
      const count = Math.min(autoCount, variants.length);
      if (count < 2) return;
      const shuffled = [...variants].sort(() => Math.random() - 0.5);
      setSelectedVariantIds(new Set(shuffled.slice(0, count).map((v) => v.id)));
    }, [autoMode, autoCount, variants]);

    function handleCategoryClick(category: string) {
      if (category === selectedCategory) return;
      setSelectedCategory(category);
      const firstSub = groups.find((g) => g.category === category)?.subcategory ?? null;
      setSelectedSubcategory(firstSub);
      setSelectedVariantIds(new Set());
    }

    function handleSubcategoryClick(subcategory: string | null) {
      setSelectedSubcategory(subcategory);
      setSelectedVariantIds(new Set());
    }

    function handleVariantToggle(id: string) {
      setSelectedVariantIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    }

    function handleAutoModeToggle(on: boolean) {
      setAutoMode(on);
      if (!on) setSelectedVariantIds(new Set());
    }

    const buildPayload = useCallback((): LibraryDraftMessage | null => {
      const selected = variants.filter((v) => selectedVariantIds.has(v.id));
      if (selected.length === 0 || messageName.trim().length === 0) return null;
      return {
        name: messageName.trim(),
        channel,
        variants: selected.map((v) => ({
          name: v.name,
          title: v.title ?? undefined,
          subject: v.subject ?? undefined,
          body: v.body,
          cta: v.cta ?? undefined,
          deeplink: v.deeplink ?? undefined,
          iconImageUrl: v.iconImageUrl ?? undefined,
          sourceTemplateId: v.id,
        })),
      };
    }, [variants, selectedVariantIds, messageName, channel]);

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

    useImperativeHandle(ref, () => ({ commitPending: commitDraft }), [commitDraft]);

    async function handleSave() {
      if (saving) return;
      if ("onAddToDraft" in props && props.onAddToDraft) {
        commitDraft();
        return;
      }
      const payload = buildPayload();
      if (!payload) return;
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

    const selectedCount = selectedVariantIds.size;
    const canSave = selectedCount > 0 && messageName.trim().length > 0 && !saving;
    const isLoading = fetchState.status === "loading";

    return (
      <div className="space-y-4" data-testid={`library-picker-${channel}`}>
        {/* Message name */}
        <div>
          <label className="mb-1.5 block text-sm font-medium">Message name</label>
          <Input
            value={messageName}
            onChange={(e) => {
              setMessageName(e.target.value);
              setNameManuallyEdited(true);
            }}
            placeholder={`e.g. ${config.label} — Giving`}
          />
        </div>

        {/* Category tabs */}
        {categories.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">Category</p>
            <div className="flex flex-wrap gap-2">
              {categories.map((cat) => (
                <Button
                  key={cat}
                  variant={cat === selectedCategory ? "default" : "outline"}
                  size="sm"
                  onClick={() => handleCategoryClick(cat)}
                >
                  {humanize(cat)}
                </Button>
              ))}
            </div>
          </div>
        )}

        {/* Subcategory pills (only when the category has named sub-goals) */}
        {subcategories.length > 1 || (subcategories.length === 1 && subcategories[0] !== null) ? (
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">Sub-goal</p>
            <div className="flex flex-wrap gap-1.5">
              {subcategories.map((sub) => (
                <Button
                  key={sub ?? "__none__"}
                  variant={sub === selectedSubcategory ? "default" : "outline"}
                  size="xs"
                  onClick={() => handleSubcategoryClick(sub)}
                >
                  {humanize(sub)}
                </Button>
              ))}
            </div>
          </div>
        ) : null}

        {/* Auto-pick controls */}
        {!isLoading && variants.length >= 2 && (
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

        {/* Toolbar */}
        <div className="flex items-center justify-between border-t pt-3">
          <span className="text-sm text-muted-foreground">
            {selectedCount === 0
              ? "No variants selected"
              : `${selectedCount} variant${selectedCount === 1 ? "" : "s"} selected`}
          </span>
          <Button size="sm" disabled={!canSave} onClick={handleSave}>
            {saving ? "Adding…" : "onAddToDraft" in props ? "Add Message" : "Save Message"}
          </Button>
        </div>

        {saveError && <p className="text-sm text-destructive">{saveError}</p>}

        {/* Variant grid */}
        <div>
          {isLoading && <p className="py-6 text-center text-xs text-muted-foreground">Loading library…</p>}
          {fetchState.status === "error" && (
            <p className="py-6 text-center text-xs text-destructive">{fetchState.message}</p>
          )}
          {fetchState.status === "done" && variants.length === 0 && (
            <p className="py-6 text-center text-xs text-muted-foreground">
              No {config.label.toLowerCase()} variants found for this category.
            </p>
          )}
          {fetchState.status === "done" && variants.length > 0 && (
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
                        : "border-border bg-background hover:border-primary/40",
                    )}
                  >
                    {selected && (
                      <div className="absolute right-2 top-2 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
                        <Check className="h-2.5 w-2.5" />
                      </div>
                    )}
                    <p className="mb-0.5 pr-5 text-xs font-semibold leading-snug">{v.name}</p>
                    <p className="text-xs leading-snug text-muted-foreground line-clamp-2">
                      {config.snippet(v)}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  },
);
