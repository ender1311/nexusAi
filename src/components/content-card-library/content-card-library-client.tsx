"use client";

import { useEffect, useRef, useState } from "react";
import { Layout, Search, LayoutGrid, List } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { ContentCardCard, type ContentCardVariant } from "./content-card-card";
import { ContentCardListRow } from "./content-card-list-row";
import { CONTENT_CARD_CATEGORIES } from "@/lib/content-card-categories";
import { sortLibraryVariants } from "@/lib/library-sort";
import { LibrarySortSelect, useLibrarySort } from "@/components/library/library-sort";

export type ContentCardGroup = {
  category: string;
  subcategory: string | null;
  variants: ContentCardVariant[];
};

type ViewMode = "grid" | "list";
type Props = { groups: ContentCardGroup[]; canManage?: boolean };

const categoryOrder = CONTENT_CARD_CATEGORIES.map((c) => c.value);

function categoryLabel(slug: string): string {
  return CONTENT_CARD_CATEGORIES.find((c) => c.value === slug)?.label ?? slug.replace(/-/g, " ");
}

function subcategoryLabel(catSlug: string | null, subSlug: string): string {
  const cat = CONTENT_CARD_CATEGORIES.find((c) => c.value === catSlug);
  return (
    cat?.subcategories.find((s) => s.value === subSlug)?.label ??
    subSlug.replace(/-/g, " ")
  );
}

function GroupLabel({ category, subcategory }: { category: string; subcategory: string | null }) {
  return (
    <span className="text-sm font-semibold text-muted-foreground">
      {categoryLabel(category)}
      {subcategory && (
        <>
          <span className="mx-1.5 text-muted-foreground/40">/</span>
          <span>{subcategoryLabel(category, subcategory)}</span>
        </>
      )}
    </span>
  );
}

export function ContentCardLibraryClient({ groups, canManage }: Props) {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [sortMode, setSortMode] = useLibrarySort("content-card-library-sort");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [serverItems, setServerItems] = useState<ContentCardVariant[] | null>(null);
  const [serverLoading, setServerLoading] = useState(false);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const saved = localStorage.getItem("content-card-library-view") as ViewMode | null;
    if (saved === "grid" || saved === "list") setViewMode(saved);
  }, []);

  const filterActive = !!(search.trim() || categoryFilter);

  useEffect(() => {
    const isActive = !!(search.trim() || categoryFilter);
    if (!isActive) {
      requestIdRef.current++;
      setServerItems(null);
      setServerLoading(false);
      return;
    }
    const myId = ++requestIdRef.current;
    setServerLoading(true);
    const t = setTimeout(async () => {
      const p = new URLSearchParams();
      if (search.trim()) p.set("q", search.trim());
      if (categoryFilter) p.set("category", categoryFilter);
      try {
        const res = await fetch(`/api/content-card-library?${p.toString()}`);
        const json = await res.json();
        if (myId !== requestIdRef.current) return;
        setServerItems(json.data?.items ?? []);
      } catch {
        if (myId !== requestIdRef.current) return;
        setServerItems([]);
      } finally {
        if (myId === requestIdRef.current) setServerLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [search, categoryFilter]);

  const sortedGroups = [...groups].sort((a, b) => {
    const ai = categoryOrder.indexOf(a.category);
    const bi = categoryOrder.indexOf(b.category);
    if (ai === -1 && bi === -1) return a.category.localeCompare(b.category);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  const categories = Array.from(new Set(sortedGroups.map((g) => g.category)));
  const allVariants = groups.flatMap((g) => g.variants);
  const flatVariants: ContentCardVariant[] = filterActive ? (serverItems ?? []) : allVariants;

  function setView(mode: ViewMode) {
    setViewMode(mode);
    localStorage.setItem("content-card-library-view", mode);
  }

  function renderGrid(variants: ContentCardVariant[]) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {variants.map((v) => <ContentCardCard key={v.id} variant={v} canManage={canManage} />)}
      </div>
    );
  }

  function renderList(variants: ContentCardVariant[]) {
    return (
      <div className="rounded-xl border overflow-hidden">
        {variants.map((v) => <ContentCardListRow key={v.id} variant={v} canManage={canManage} />)}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search name, title, body, CTA…"
              className="pl-8 h-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <LibrarySortSelect value={sortMode} onChange={setSortMode} />
          <div className="flex items-center border rounded-lg overflow-hidden shrink-0">
            <button
              title="Grid view"
              onClick={() => setView("grid")}
              className={cn(
                "p-2 transition-colors",
                viewMode === "grid"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted",
              )}
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button
              title="List view"
              onClick={() => setView("list")}
              className={cn(
                "p-2 border-l transition-colors",
                viewMode === "list"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted",
              )}
            >
              <List className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="shrink-0 text-xs text-muted-foreground font-medium">Category:</span>
          <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide pb-0.5">
            <button
              onClick={() => setCategoryFilter(null)}
              className={cn(
                "shrink-0 px-3 py-1 rounded-full text-xs font-medium border transition-colors",
                !categoryFilter
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-muted-foreground border-border hover:text-foreground hover:border-foreground",
              )}
            >
              All
            </button>
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setCategoryFilter(categoryFilter === cat ? null : cat)}
                className={cn(
                  "shrink-0 px-3 py-1 rounded-full text-xs font-medium border transition-colors",
                  categoryFilter === cat
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background text-muted-foreground border-border hover:text-foreground hover:border-foreground",
                )}
              >
                {categoryLabel(cat)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Results */}
      {filterActive ? (
        serverLoading ? (
          <SearchSkeleton viewMode={viewMode} />
        ) : flatVariants.length === 0 ? (
          <div className="py-16 text-center">
            <Layout className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm font-medium text-muted-foreground">No results</p>
            <p className="text-xs text-muted-foreground mt-1">
              Try a different search term or category.
            </p>
            <button
              className="mt-3 text-xs text-primary underline-offset-4 hover:underline"
              onClick={() => { setSearch(""); setCategoryFilter(null); }}
            >
              Clear filters
            </button>
          </div>
        ) : (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground pb-1">
              {flatVariants.length} result{flatVariants.length !== 1 ? "s" : ""}
            </p>
            {viewMode === "grid"
              ? renderGrid(sortLibraryVariants(flatVariants, sortMode))
              : renderList(sortLibraryVariants(flatVariants, sortMode))}
          </div>
        )
      ) : allVariants.length === 0 ? (
        <div className="py-16 text-center">
          <Layout className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm font-medium text-muted-foreground">No content card templates yet</p>
          <p className="text-xs text-muted-foreground mt-1">
            Add templates via the API or seed script.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {sortedGroups.map((group) => {
            const key = `${group.category}-${group.subcategory ?? "none"}`;
            const isCollapsed = collapsed[key] ?? false;

            return (
              <section key={key}>
                <button
                  onClick={() => setCollapsed((p) => ({ ...p, [key]: !p[key] }))}
                  className="flex items-center gap-2 w-full text-left mb-3 group/header"
                >
                  <Layout className="h-4 w-4 text-muted-foreground shrink-0" />
                  <GroupLabel category={group.category} subcategory={group.subcategory} />
                  <Badge variant="secondary" className="ml-1 shrink-0">
                    {group.variants.length}
                  </Badge>
                  <span className="ml-auto text-[10px] text-muted-foreground/50 group-hover/header:text-muted-foreground transition-colors">
                    {isCollapsed ? "show" : "hide"}
                  </span>
                </button>

                {!isCollapsed && (
                  viewMode === "grid"
                    ? renderGrid(sortLibraryVariants(group.variants, sortMode))
                    : renderList(sortLibraryVariants(group.variants, sortMode))
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SearchSkeleton({ viewMode }: { viewMode: ViewMode }) {
  if (viewMode === "list") {
    return (
      <div className="rounded-xl border overflow-hidden">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3 border-b last:border-0">
            <Skeleton className="h-1.5 w-1.5 rounded-full" />
            <Skeleton className="h-4 flex-1 max-w-[180px]" />
            <Skeleton className="h-4 flex-1 hidden sm:block" />
            <Skeleton className="h-5 w-14 rounded-full" />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {[1, 2, 3, 4].map((i) => (
        <Skeleton key={i} className="h-52 rounded-xl" />
      ))}
    </div>
  );
}
