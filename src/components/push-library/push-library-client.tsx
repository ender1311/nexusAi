"use client";

import { useState, useMemo } from "react";
import { BookOpen, ChevronDown, ChevronRight, LayoutGrid, List, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { TemplateCard } from "./template-card";
import { TemplateFormSheet } from "./template-form-sheet";
import { DeleteConfirmDialog } from "./delete-confirm-dialog";

export type TemplateVariant = {
  id: string;
  name: string;
  title: string | null;
  body: string;
  deeplink: string | null;
  cta: string | null;
  category: string | null;
  subcategory: string | null;
  languages: string[]; // canonical non-English translation codes present for this variant
};

export type TemplateGroup = {
  category: string;
  subcategory: string | null;
  variants: TemplateVariant[];
};

type Props = {
  groups: TemplateGroup[];
  isAdmin: boolean;
};

const CATEGORY_ORDER = ["reader", "votd", "plans", "guided-scripture", "guided-prayer"];

export function PushLibraryClient({ groups, isAdmin }: Props) {
  const [view, setView] = useState<"grid" | "table">("table");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [subcategoryFilter, setSubcategoryFilter] = useState<string | null>(null);

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

  const allVariants = groups.flatMap((g) => g.variants);
  const categories = Array.from(new Set(groups.map((g) => g.category))).sort(
    (a, b) => {
      const ai = CATEGORY_ORDER.indexOf(a);
      const bi = CATEGORY_ORDER.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    }
  );

  const subcategoriesForFilter = useMemo(() => {
    if (!categoryFilter) return [];
    return Array.from(
      new Set(
        groups
          .filter((g) => g.category === categoryFilter && g.subcategory !== null)
          .map((g) => g.subcategory as string)
      )
    );
  }, [groups, categoryFilter]);

  const filteredVariants = useMemo(() => {
    const q = search.toLowerCase();
    return allVariants.filter((v) => {
      const matchSearch =
        !q ||
        v.name.toLowerCase().includes(q) ||
        v.body.toLowerCase().includes(q) ||
        (v.title ?? "").toLowerCase().includes(q);
      const matchCategory = !categoryFilter || v.category === categoryFilter;
      const matchSubcategory = !subcategoryFilter || v.subcategory === subcategoryFilter;
      return matchSearch && matchCategory && matchSubcategory;
    });
  }, [allVariants, search, categoryFilter, subcategoryFilter]);

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
                {formatLabel(cat)}
              </button>
            ))}
          </div>
          {subcategoriesForFilter.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap">
              <button
                onClick={() => setSubcategoryFilter(null)}
                className={cn(
                  "px-3 py-1 rounded-full text-xs font-medium border transition-colors capitalize",
                  !subcategoryFilter
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background text-muted-foreground border-border hover:text-foreground hover:border-foreground"
                )}
              >
                All {categoryFilter ? formatLabel(categoryFilter) : ""}
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
                  {formatLabel(sub)}
                </button>
              ))}
            </div>
          )}
        </div>

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

      {view === "table" ? (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 border-b">
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground w-[140px]">Category</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground w-[180px]">Title</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Body</th>
                {isAdmin && (
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground w-[120px]">Actions</th>
                )}
              </tr>
            </thead>
            <tbody>
              {filteredVariants.length === 0 ? (
                <tr>
                  <td colSpan={isAdmin ? 4 : 3} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    No results
                  </td>
                </tr>
              ) : (
                filteredVariants.map((v, i) => (
                  <tr key={v.id} className={cn("border-t align-top", i % 2 !== 0 && "bg-muted/20")}>
                    <td className="px-4 py-3">
                      <span className="text-xs font-medium capitalize">{v.category ?? "—"}</span>
                      {v.subcategory && (
                        <span className="block text-xs text-muted-foreground capitalize">{v.subcategory}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {v.title ?? <span className="opacity-40">—</span>}
                    </td>
                    <td className="px-4 py-3 text-sm leading-relaxed">{v.body}</td>
                    {isAdmin && (
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
          {filteredVariants.length > 0 && (
            <div className="px-4 py-2 border-t bg-muted/30 text-xs text-muted-foreground">
              {filteredVariants.length} of {allVariants.length} pushes
            </div>
          )}
        </div>
      ) : (
        groups.map((group) => {
          const key = `${group.category}-${group.subcategory ?? "none"}`;
          const label = group.subcategory
            ? `${group.category} / ${group.subcategory}`
            : group.category;
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
                    <TemplateCard key={v.id} variant={v} isAdmin={isAdmin} />
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
