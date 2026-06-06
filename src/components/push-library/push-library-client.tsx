"use client";

import { useEffect, useMemo, useState } from "react";
import { BookOpen, ChevronDown, ChevronRight, LayoutGrid, List, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { TemplateCard } from "./template-card";
import { TemplateFormSheet } from "./template-form-sheet";
import { DeleteConfirmDialog } from "./delete-confirm-dialog";
import { useTaxonomy, activeTaxonomy } from "./use-taxonomy";
import { maskPersonalization } from "@/lib/messages/personalization";
import { isPushVariantComplete } from "@/lib/messages/push-completeness";

export type TemplateVariant = {
  id: string;
  name: string;
  title: string | null;
  body: string;
  deeplink: string | null;
  cta: string | null;
  category: string | null;
  subcategory: string | null;
  iconImageUrl: string | null;
  languages: string[]; // canonical non-English translation codes present for this variant
};

export type TemplateGroup = {
  category: string;
  subcategory: string | null;
  variants: TemplateVariant[];
};

type Props = {
  groups: TemplateGroup[];
  canManageLibrary: boolean;
};

export function PushLibraryClient({ groups, canManageLibrary }: Props) {
  const { taxonomy } = useTaxonomy();
  const categoryOrder = taxonomy.map((c) => c.slug);

  const [view, setView] = useState<"grid" | "table">("table");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [subcategoryFilter, setSubcategoryFilter] = useState<string | null>(null);
  const [sort, setSort] = useState<"createdAt" | "name">("createdAt");
  const [serverItems, setServerItems] = useState<TemplateVariant[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Local copy of grouped data so drag-reorder is reflected immediately.
  const [localGroups, setLocalGroups] = useState<TemplateGroup[]>(groups);
  useEffect(() => { setLocalGroups(groups); }, [groups]);

  const filterActive = !!(search.trim() || categoryFilter || subcategoryFilter || sort !== "createdAt");

  useEffect(() => {
    if (!filterActive) { setServerItems(null); return; }
    const t = setTimeout(async () => {
      const p = new URLSearchParams();
      if (search.trim()) p.set("q", search.trim());
      if (categoryFilter) p.set("category", categoryFilter);
      if (subcategoryFilter) p.set("subcategory", subcategoryFilter);
      p.set("sort", sort);
      const res = await fetch(`/api/push-library?${p.toString()}`);
      const json = await res.json();
      setServerItems(json.data?.items ?? []);
    }, 250);
    return () => clearTimeout(t);
  }, [search, categoryFilter, subcategoryFilter, sort, filterActive]);

  function toggleSection(key: string) {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function handleCategoryClick(cat: string | null) {
    setCategoryFilter(cat);
    setSubcategoryFilter(null);
  }

  function formatLabel(slug: string): string {
    return slug
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  }

  function categoryLabel(slug: string): string {
    return taxonomy.find((c) => c.slug === slug)?.label ?? formatLabel(slug);
  }

  function subcategoryLabel(catSlug: string | null, subSlug: string): string {
    const cat = taxonomy.find((c) => c.slug === catSlug);
    return cat?.subcategories.find((s) => s.slug === subSlug)?.label ?? formatLabel(subSlug);
  }

  const allVariants = localGroups.flatMap((g) => g.variants);
  const categories = Array.from(new Set(localGroups.map((g) => g.category))).sort((a, b) => {
    const ai = categoryOrder.indexOf(a);
    const bi = categoryOrder.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  const subcategoriesForFilter = useMemo(() => {
    if (!categoryFilter) return [];
    return Array.from(
      new Set(
        localGroups
          .filter((g) => g.category === categoryFilter && g.subcategory !== null)
          .map((g) => g.subcategory as string)
      )
    );
  }, [localGroups, categoryFilter]);

  // When a filter/search/sort is active, results come from the server (flat list);
  // otherwise we browse the grouped data passed in as a prop.
  const flatVariants = filterActive ? (serverItems ?? []) : allVariants;

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // ---- Bulk operations ----
  const activeCats = activeTaxonomy(taxonomy);
  const [bulkCategory, setBulkCategory] = useState("");
  const [bulkSubcategory, setBulkSubcategory] = useState("");
  const [bulkStatus, setBulkStatus] = useState("active");
  const bulkSelectedCat = activeCats.find((c) => c.slug === bulkCategory);

  async function runBulk(body: Record<string, unknown>) {
    const res = await fetch("/api/push-library/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [...selected], ...body }),
    });
    if (res.ok) {
      setSelected(new Set());
      location.reload();
    }
  }

  // ---- Drag-to-reorder within a grouped subcategory section ----
  const [draggingId, setDraggingId] = useState<string | null>(null);

  async function reorderWithinGroup(groupKey: string, fromId: string, toId: string) {
    if (fromId === toId) return;
    let orderedIds: string[] = [];
    setLocalGroups((prev) =>
      prev.map((g) => {
        if (`${g.category}-${g.subcategory ?? "none"}` !== groupKey) return g;
        const vs = [...g.variants];
        const fromIdx = vs.findIndex((v) => v.id === fromId);
        const toIdx = vs.findIndex((v) => v.id === toId);
        if (fromIdx === -1 || toIdx === -1) return g;
        const [moved] = vs.splice(fromIdx, 1);
        vs.splice(toIdx, 0, moved);
        orderedIds = vs.map((v) => v.id);
        return { ...g, variants: vs };
      })
    );
    if (orderedIds.length > 0) {
      await fetch("/api/push-library/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: orderedIds }),
      });
    }
  }

  const reorderable = canManageLibrary && !filterActive;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search title, body…"
            className="pl-8 h-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1.5 flex-1">
          <div className="flex items-center gap-1 flex-wrap">
            <button
              onClick={() => handleCategoryClick(null)}
              className={cn(
                "px-3 py-1 rounded-full text-xs font-medium border transition-colors",
                !categoryFilter
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-muted-foreground border-border hover:text-foreground hover:border-foreground"
              )}
            >
              All
            </button>
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => handleCategoryClick(categoryFilter === cat ? null : cat)}
                className={cn(
                  "px-3 py-1 rounded-full text-xs font-medium border transition-colors",
                  categoryFilter === cat
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background text-muted-foreground border-border hover:text-foreground hover:border-foreground"
                )}
              >
                {categoryLabel(cat)}
              </button>
            ))}
          </div>
          {subcategoriesForFilter.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap">
              <button
                onClick={() => setSubcategoryFilter(null)}
                className={cn(
                  "px-3 py-1 rounded-full text-xs font-medium border transition-colors",
                  !subcategoryFilter
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background text-muted-foreground border-border hover:text-foreground hover:border-foreground"
                )}
              >
                All {categoryFilter ? categoryLabel(categoryFilter) : ""}
              </button>
              {subcategoriesForFilter.map((sub) => (
                <button
                  key={sub}
                  onClick={() => setSubcategoryFilter(subcategoryFilter === sub ? null : sub)}
                  className={cn(
                    "px-3 py-1 rounded-full text-xs font-medium border transition-colors",
                    subcategoryFilter === sub
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background text-muted-foreground border-border hover:text-foreground hover:border-foreground"
                  )}
                >
                  {subcategoryLabel(categoryFilter, sub)}
                </button>
              ))}
            </div>
          )}
        </div>

        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as "createdAt" | "name")}
          className="h-9 rounded-md border bg-background px-2 text-xs shrink-0"
          aria-label="Sort"
        >
          <option value="createdAt">Newest</option>
          <option value="name">Name</option>
        </select>

        <div className="flex items-center gap-1 border rounded-lg p-1 shrink-0">
          <button
            onClick={() => setView("table")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors",
              view === "table"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            )}
          >
            <List className="h-3.5 w-3.5" />
            Table
          </button>
          <button
            onClick={() => setView("grid")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors",
              view === "grid"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            )}
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            Cards
          </button>
        </div>
      </div>

      {/* Bulk toolbar */}
      {canManageLibrary && selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 p-2 text-xs">
          <span className="font-medium">{selected.size} selected</span>
          <div className="flex items-center gap-1">
            <select
              value={bulkCategory}
              onChange={(e) => { setBulkCategory(e.target.value); setBulkSubcategory(""); }}
              className="h-8 rounded-md border bg-background px-2"
              aria-label="Bulk category"
            >
              <option value="">Category…</option>
              {activeCats.map((c) => <option key={c.id} value={c.slug}>{c.label}</option>)}
            </select>
            <select
              value={bulkSubcategory}
              onChange={(e) => setBulkSubcategory(e.target.value)}
              className="h-8 rounded-md border bg-background px-2"
              aria-label="Bulk subcategory"
              disabled={!bulkSelectedCat}
            >
              <option value="">Subcategory…</option>
              {bulkSelectedCat?.subcategories.map((s) => <option key={s.id} value={s.slug}>{s.label}</option>)}
            </select>
            <Button
              size="sm"
              variant="outline"
              disabled={!bulkCategory}
              onClick={() => runBulk({ op: "recategorize", category: bulkCategory, subcategory: bulkSubcategory || undefined })}
            >
              Recategorize
            </Button>
          </div>
          <div className="flex items-center gap-1">
            <select
              value={bulkStatus}
              onChange={(e) => setBulkStatus(e.target.value)}
              className="h-8 rounded-md border bg-background px-2"
              aria-label="Bulk status"
            >
              <option value="active">active</option>
              <option value="paused">paused</option>
            </select>
            <Button size="sm" variant="outline" onClick={() => runBulk({ op: "setStatus", status: bulkStatus })}>
              Set status
            </Button>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="text-destructive hover:text-destructive hover:border-destructive/30"
            onClick={() => runBulk({ op: "delete" })}
          >
            Delete
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
        </div>
      )}

      {view === "table" ? (
        <div className="border rounded-lg overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="bg-muted/50 border-b">
                {canManageLibrary && <th className="px-3 py-2.5 w-[36px]" />}
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground w-[140px]">Category</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground w-[180px]">Title</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Body</th>
                {canManageLibrary && (
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground w-[120px]">Actions</th>
                )}
              </tr>
            </thead>
            <tbody>
              {flatVariants.length === 0 ? (
                <tr>
                  <td colSpan={canManageLibrary ? 5 : 3} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    No results
                  </td>
                </tr>
              ) : (
                flatVariants.map((v, i) => (
                  <tr key={v.id} className={cn("border-t align-top", i % 2 !== 0 && "bg-muted/20")}>
                    {canManageLibrary && (
                      <td className="px-3 py-3">
                        <input type="checkbox" checked={selected.has(v.id)} onChange={() => toggleSelected(v.id)} aria-label={`Select ${v.name}`} />
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <span className="text-xs font-medium">{v.category ? categoryLabel(v.category) : "—"}</span>
                      {v.subcategory && (
                        <span className="block text-xs text-muted-foreground">{subcategoryLabel(v.category, v.subcategory)}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      <div className="flex items-start gap-1.5">
                        <span>{maskPersonalization(v.title) ?? <span className="opacity-40">—</span>}</span>
                        {!isPushVariantComplete(v) && (
                          <Badge variant="destructive" className="shrink-0 text-xs">Incomplete</Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm leading-relaxed">{maskPersonalization(v.body)}</td>
                    {canManageLibrary && (
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <TemplateFormSheet mode="edit" variant={v}>
                            <Button variant="outline" size="sm">Edit</Button>
                          </TemplateFormSheet>
                          <DeleteConfirmDialog variantId={v.id} variantName={v.name}>
                            <Button variant="outline" size="sm" className="text-destructive hover:text-destructive hover:border-destructive/30">
                              Delete
                            </Button>
                          </DeleteConfirmDialog>
                        </div>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
          {flatVariants.length > 0 && (
            <div className="px-4 py-2 border-t bg-muted/30 text-xs text-muted-foreground">
              {flatVariants.length}{!filterActive ? ` of ${allVariants.length}` : ""} pushes
            </div>
          )}
        </div>
      ) : filterActive ? (
        flatVariants.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">No results</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {flatVariants.map((v) => (
              <div key={v.id} className="relative">
                {canManageLibrary && (
                  <input
                    type="checkbox"
                    checked={selected.has(v.id)}
                    onChange={() => toggleSelected(v.id)}
                    className="absolute left-2 top-2 z-10"
                    aria-label={`Select ${v.name}`}
                  />
                )}
                <TemplateCard variant={v} isAdmin={canManageLibrary} />
              </div>
            ))}
          </div>
        )
      ) : (
        localGroups.map((group) => {
          const key = `${group.category}-${group.subcategory ?? "none"}`;
          const label = group.subcategory
            ? `${categoryLabel(group.category)} / ${subcategoryLabel(group.category, group.subcategory)}`
            : categoryLabel(group.category);
          const isCollapsed = collapsed[key] ?? false;

          return (
            <section key={key}>
              <button
                onClick={() => toggleSection(key)}
                className="flex items-center gap-2 w-full text-left mb-3 group"
              >
                {isCollapsed ? (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                )}
                <BookOpen className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-semibold text-muted-foreground">{label}</span>
                <Badge variant="secondary" className="ml-1">
                  {group.variants.length}
                </Badge>
              </button>
              {!isCollapsed && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {group.variants.map((v) => (
                    <div
                      key={v.id}
                      className="relative"
                      draggable={reorderable}
                      onDragStart={() => reorderable && setDraggingId(v.id)}
                      onDragOver={(e) => { if (reorderable) e.preventDefault(); }}
                      onDrop={(e) => {
                        if (!reorderable || !draggingId) return;
                        e.preventDefault();
                        void reorderWithinGroup(key, draggingId, v.id);
                        setDraggingId(null);
                      }}
                    >
                      {canManageLibrary && (
                        <input
                          type="checkbox"
                          checked={selected.has(v.id)}
                          onChange={() => toggleSelected(v.id)}
                          className="absolute left-2 top-2 z-10"
                          aria-label={`Select ${v.name}`}
                        />
                      )}
                      <TemplateCard variant={v} isAdmin={canManageLibrary} />
                    </div>
                  ))}
                </div>
              )}
            </section>
          );
        })
      )}
    </div>
  );
}
