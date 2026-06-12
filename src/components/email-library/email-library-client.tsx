"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Mail, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { EmailCard, type EmailVariant } from "./email-card";
import { EMAIL_CATEGORIES } from "@/lib/email-categories";

export type EmailGroup = {
  category: string;
  subcategory: string | null;
  variants: EmailVariant[];
};

type Props = { groups: EmailGroup[] };

const categoryOrder = EMAIL_CATEGORIES.map((c) => c.value);

function formatLabel(slug: string): string {
  return slug.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function categoryLabel(slug: string): string {
  return EMAIL_CATEGORIES.find((c) => c.value === slug)?.label ?? formatLabel(slug);
}

function subcategoryLabel(catSlug: string | null, subSlug: string): string {
  const cat = EMAIL_CATEGORIES.find((c) => c.value === catSlug);
  return cat?.subcategories.find((s) => s.value === subSlug)?.label ?? formatLabel(subSlug);
}

export function EmailLibraryClient({ groups }: Props) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [serverItems, setServerItems] = useState<EmailVariant[] | null>(null);

  const filterActive = !!(search.trim() || categoryFilter);

  useEffect(() => {
    if (!filterActive) { setTimeout(() => setServerItems(null), 0); return; }
    const t = setTimeout(async () => {
      const p = new URLSearchParams();
      if (search.trim()) p.set("q", search.trim());
      if (categoryFilter) p.set("category", categoryFilter);
      const res = await fetch(`/api/email-library?${p.toString()}`);
      const json = await res.json();
      setServerItems(json.data?.items ?? []);
    }, 250);
    return () => clearTimeout(t);
  }, [search, categoryFilter, filterActive]);

  const sortedGroups = [...groups].sort((a, b) => {
    const ai = categoryOrder.indexOf(a.category);
    const bi = categoryOrder.indexOf(b.category);
    if (ai === -1 && bi === -1) return a.category.localeCompare(b.category);
    if (ai === -1) return 1; if (bi === -1) return -1;
    return ai - bi;
  });

  const categories = Array.from(new Set(sortedGroups.map((g) => g.category)));
  const allVariants = groups.flatMap((g) => g.variants);
  const flatVariants = filterActive ? (serverItems ?? []) : allVariants;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <div className="relative w-full sm:flex-1 sm:max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search subject, name…"
            className="pl-8 h-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          <button
            onClick={() => setCategoryFilter(null)}
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
              onClick={() => setCategoryFilter(categoryFilter === cat ? null : cat)}
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
      </div>

      {filterActive ? (
        flatVariants.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">No results</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {flatVariants.map((v) => <EmailCard key={v.id} variant={v} />)}
          </div>
        )
      ) : (
        sortedGroups.map((group) => {
          const key = `${group.category}-${group.subcategory ?? "none"}`;
          const label = group.subcategory
            ? `${categoryLabel(group.category)} / ${subcategoryLabel(group.category, group.subcategory)}`
            : categoryLabel(group.category);
          const isCollapsed = collapsed[key] ?? false;

          return (
            <section key={key}>
              <button
                onClick={() => setCollapsed((p) => ({ ...p, [key]: !p[key] }))}
                className="flex items-center gap-2 w-full text-left mb-3 group"
              >
                {isCollapsed ? (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                )}
                <Mail className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-semibold text-muted-foreground">{label}</span>
                <Badge variant="secondary" className="ml-1">{group.variants.length}</Badge>
              </button>
              {!isCollapsed && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
                  {group.variants.map((v) => <EmailCard key={v.id} variant={v} />)}
                </div>
              )}
            </section>
          );
        })
      )}

      {!filterActive && allVariants.length === 0 && (
        <div className="py-16 text-center">
          <Mail className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No email templates yet.</p>
          <p className="text-xs text-muted-foreground mt-1">Run the seed script to import templates from the Dropbox campaign library.</p>
        </div>
      )}
    </div>
  );
}
