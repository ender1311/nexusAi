"use client";

import { useEffect, useRef, useState } from "react";
import { Mail, Maximize2, Search, LayoutGrid, List, X, ArrowUpDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { EmailCard, type EmailVariant } from "./email-card";
import { EmailListRow } from "./email-list-row";
import { EMAIL_CATEGORIES } from "@/lib/email-categories";

export type EmailGroup = {
  category: string;
  subcategory: string | null;
  variants: EmailVariant[];
};

type ViewMode = "grid" | "list";
type SortMode = "default" | "name-asc" | "name-desc" | "langs-desc";
type HtmlCache = { en: string; langs: Record<string, string> };

type Props = { groups: EmailGroup[] };

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: "default",    label: "Default order" },
  { value: "name-asc",   label: "Name A–Z" },
  { value: "name-desc",  label: "Name Z–A" },
  { value: "langs-desc", label: "Most languages" },
];

const LS_SORT = "email-library-sort";

function sortVariants(variants: EmailVariant[], mode: SortMode): EmailVariant[] {
  if (mode === "default") return variants;
  const copy = [...variants];
  switch (mode) {
    case "name-asc":   copy.sort((a, b) => a.name.localeCompare(b.name)); break;
    case "name-desc":  copy.sort((a, b) => b.name.localeCompare(a.name)); break;
    // +1 for the base "en" template, which isn't in the translations array.
    case "langs-desc": copy.sort((a, b) => (b.translations.length - a.translations.length) || a.name.localeCompare(b.name)); break;
  }
  return copy;
}

const categoryOrder = EMAIL_CATEGORIES.map((c) => c.value);

function categoryLabel(slug: string): string {
  return EMAIL_CATEGORIES.find((c) => c.value === slug)?.label ?? slug.replace(/-/g, " ");
}

function subcategoryLabel(catSlug: string | null, subSlug: string): string {
  const cat = EMAIL_CATEGORIES.find((c) => c.value === catSlug);
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

export function EmailLibraryClient({ groups }: Props) {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [sortMode, setSortMode] = useState<SortMode>("default");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [serverItems, setServerItems] = useState<EmailVariant[] | null>(null);
  const [serverLoading, setServerLoading] = useState(false);
  const requestIdRef = useRef(0);

  // Preview panel state
  const [selectedVariant, setSelectedVariant] = useState<EmailVariant | null>(null);
  const [selectedLang, setSelectedLang] = useState("en");
  const [htmlCache, setHtmlCache] = useState<Map<string, HtmlCache>>(new Map());
  const [htmlLoading, setHtmlLoading] = useState(false);
  const [expandOpen, setExpandOpen] = useState(false);
  const loadPromiseRef = useRef<Map<string, Promise<HtmlCache>>>(new Map());

  // Restore view + sort preferences after hydration
  useEffect(() => {
    const savedView = localStorage.getItem("email-library-view") as ViewMode | null;
    if (savedView === "grid" || savedView === "list") setViewMode(savedView);
    const savedSort = localStorage.getItem(LS_SORT) as SortMode | null;
    if (savedSort && SORT_OPTIONS.some((o) => o.value === savedSort)) setSortMode(savedSort);
  }, []);

  function setSort(mode: SortMode) {
    setSortMode(mode);
    localStorage.setItem(LS_SORT, mode);
  }

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
        const res = await fetch(`/api/email-library?${p.toString()}`);
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

  function loadHtml(variant: EmailVariant): Promise<HtmlCache> {
    const cached = htmlCache.get(variant.id);
    if (cached) return Promise.resolve(cached);

    const existing = loadPromiseRef.current.get(variant.id);
    if (existing) return existing;

    setHtmlLoading(true);
    const promise = (async () => {
      try {
        const res = await fetch(`/api/email-library?id=${variant.id}`, { method: "PATCH" });
        const json = await res.json();
        const langs: Record<string, string> = {};
        for (const t of (json.data?.translations ?? []) as {
          language: string;
          htmlBody: string | null;
        }[]) {
          langs[t.language] = t.htmlBody ?? "";
        }
        const loaded: HtmlCache = { en: json.data?.htmlBody ?? "", langs };
        setHtmlCache((prev) => new Map(prev).set(variant.id, loaded));
        return loaded;
      } finally {
        setHtmlLoading(false);
        loadPromiseRef.current.delete(variant.id);
      }
    })();
    loadPromiseRef.current.set(variant.id, promise);
    return promise;
  }

  async function handleSelect(variant: EmailVariant, lang = "en") {
    setSelectedVariant(variant);
    setSelectedLang(lang);
    await loadHtml(variant);
  }

  function closePanel() {
    setSelectedVariant(null);
  }

  const panelCache = selectedVariant ? htmlCache.get(selectedVariant.id) ?? null : null;
  const panelHtml = panelCache
    ? selectedLang === "en"
      ? panelCache.en || null
      : panelCache.langs[selectedLang] || null
    : null;
  const panelSubject = selectedVariant
    ? selectedLang === "en"
      ? (selectedVariant.subject ?? "—")
      : (selectedVariant.translations.find((t) => t.language === selectedLang)?.subject ?? "—")
    : "—";
  const panelAllLangs = selectedVariant
    ? ["en", ...selectedVariant.translations.map((t) => t.language)]
    : [];

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
  const flatVariants: EmailVariant[] = filterActive ? (serverItems ?? []) : allVariants;

  function setView(mode: ViewMode) {
    setViewMode(mode);
    localStorage.setItem("email-library-view", mode);
  }

  function renderGrid(variants: EmailVariant[]) {
    return (
      <div
        className={cn(
          "grid gap-4 grid-cols-1 sm:grid-cols-2",
          selectedVariant
            ? "lg:grid-cols-2 xl:grid-cols-3"
            : "lg:grid-cols-3 xl:grid-cols-4",
        )}
      >
        {variants.map((v) => (
          <EmailCard
            key={v.id}
            variant={v}
            onSelect={handleSelect}
            selected={selectedVariant?.id === v.id}
          />
        ))}
      </div>
    );
  }

  function renderList(variants: EmailVariant[]) {
    return (
      <div className="rounded-xl border overflow-hidden">
        {variants.map((v) => (
          <EmailListRow
            key={v.id}
            variant={v}
            onSelect={handleSelect}
            selected={selectedVariant?.id === v.id}
          />
        ))}
      </div>
    );
  }

  const cardsContent = (
    <>
      {filterActive ? (
        serverLoading ? (
          <SearchSkeleton viewMode={viewMode} />
        ) : flatVariants.length === 0 ? (
          <div className="py-16 text-center">
            <Mail className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm font-medium text-muted-foreground">No results</p>
            <p className="text-xs text-muted-foreground mt-1">
              Try a different search term or category.
            </p>
            <button
              className="mt-3 text-xs text-primary underline-offset-4 hover:underline"
              onClick={() => {
                setSearch("");
                setCategoryFilter(null);
              }}
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
              ? renderGrid(sortVariants(flatVariants, sortMode))
              : renderList(sortVariants(flatVariants, sortMode))}
          </div>
        )
      ) : allVariants.length === 0 ? (
        <div className="py-16 text-center">
          <Mail className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm font-medium text-muted-foreground">No email templates yet</p>
          <p className="text-xs text-muted-foreground mt-1">
            Run the seed script to import templates from the Dropbox campaign library.
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
                  <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
                  <GroupLabel category={group.category} subcategory={group.subcategory} />
                  <Badge variant="secondary" className="ml-1 shrink-0">
                    {group.variants.length}
                  </Badge>
                  <span className="ml-auto text-[10px] text-muted-foreground/50 group-hover/header:text-muted-foreground transition-colors">
                    {isCollapsed ? "show" : "hide"}
                  </span>
                </button>

                {!isCollapsed &&
                  (viewMode === "grid"
                    ? renderGrid(sortVariants(group.variants, sortMode))
                    : renderList(sortVariants(group.variants, sortMode)))}
              </section>
            );
          })}
        </div>
      )}
    </>
  );

  return (
    <div className="space-y-4">
      {/* Toolbar — always full width */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search name, subject, body, CTA…"
              className="pl-8 h-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <Select value={sortMode} onValueChange={(v) => v && setSort(v as SortMode)}>
            <SelectTrigger className="h-9 w-[160px] shrink-0" aria-label="Sort templates">
              <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

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

      {/* Content + preview panel */}
      {selectedVariant ? (
        <div className="flex gap-4 items-start">
          {/* Left: scrollable cards */}
          <div className="flex-1 min-w-0">{cardsContent}</div>

          {/* Right: sticky preview panel */}
          <div className="w-[420px] xl:w-[460px] shrink-0 sticky top-4 self-start rounded-xl border bg-card shadow-lg overflow-hidden flex flex-col max-h-[calc(100vh-6rem)]">
            {/* Panel header */}
            <div className="px-4 pt-4 pb-3 border-b shrink-0 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold leading-snug truncate">
                    {selectedVariant.name}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    <span className="font-medium text-foreground/80">Subject:</span>{" "}
                    {panelSubject}
                  </p>
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    title="Expand to full width"
                    onClick={() => setExpandOpen(true)}
                    className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  >
                    <Maximize2 className="h-3.5 w-3.5" />
                  </button>
                  <button
                    title="Close preview"
                    onClick={closePanel}
                    className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Lang switcher */}
              {panelAllLangs.length > 1 && (
                <div className="flex items-center gap-1 flex-wrap">
                  {panelAllLangs.map((l) => (
                    <button
                      key={l}
                      onClick={() => setSelectedLang(l)}
                      className={cn(
                        "px-2 py-0.5 rounded text-[11px] font-mono font-medium transition-colors",
                        selectedLang === l
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted",
                      )}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* iframe */}
            <div className="flex-1 overflow-auto min-h-0">
              {htmlLoading && !panelCache ? (
                <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">
                  Loading preview…
                </div>
              ) : panelHtml ? (
                <iframe
                  key={`${selectedVariant.id}-${selectedLang}`}
                  srcDoc={panelHtml}
                  className="w-full h-full min-h-[500px] border-0"
                  sandbox="allow-same-origin"
                  title={`Email preview — ${selectedLang}`}
                />
              ) : !htmlLoading ? (
                <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">
                  No HTML available for {selectedLang}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : (
        cardsContent
      )}

      {/* Expand — full-width Dialog */}
      <Dialog open={expandOpen} onOpenChange={setExpandOpen}>
        <DialogContent className="max-w-5xl max-h-[92vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-6 pt-5 pb-4 border-b shrink-0 gap-1.5">
            <DialogTitle className="text-sm font-semibold leading-snug pr-6">
              {selectedVariant?.name}
            </DialogTitle>
            {panelAllLangs.length > 1 && (
              <div className="flex items-center gap-1 flex-wrap pt-0.5">
                {panelAllLangs.map((l) => (
                  <button
                    key={l}
                    onClick={() => setSelectedLang(l)}
                    className={cn(
                      "px-2.5 py-0.5 rounded-md text-[11px] font-mono font-medium transition-colors",
                      selectedLang === l
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted",
                    )}
                  >
                    {l}
                  </button>
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground/80">Subject:</span> {panelSubject}
            </p>
          </DialogHeader>

          <div className="flex-1 overflow-auto">
            {htmlLoading && !panelCache ? (
              <div className="flex items-center justify-center h-64 text-sm text-muted-foreground">
                Loading preview…
              </div>
            ) : panelHtml ? (
              <iframe
                key={`expand-${selectedVariant?.id}-${selectedLang}`}
                srcDoc={panelHtml}
                className="w-full h-full min-h-[600px] border-0"
                sandbox="allow-same-origin"
                title={`Email preview — ${selectedLang}`}
              />
            ) : !htmlLoading ? (
              <div className="flex items-center justify-center h-64 text-sm text-muted-foreground">
                No HTML available for {selectedLang}
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SearchSkeleton({ viewMode }: { viewMode: ViewMode }) {
  if (viewMode === "list") {
    return (
      <div className="rounded-xl border overflow-hidden">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3 border-b last:border-0">
            <Skeleton className="h-4 w-4 rounded" />
            <Skeleton className="h-4 flex-1 max-w-[180px]" />
            <Skeleton className="h-4 flex-1 hidden sm:block" />
            <Skeleton className="h-5 w-12 rounded-full" />
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
