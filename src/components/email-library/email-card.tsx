"use client";

import { Button } from "@/components/ui/button";
import { Eye } from "lucide-react";
import { cn } from "@/lib/utils";

export type EmailVariant = {
  id: string;
  name: string;
  subject: string | null;
  body: string;
  deeplink: string | null;
  cta: string | null;
  category: string | null;
  subcategory: string | null;
  sortOrder: number;
  translations: { language: string; subject: string | null; status: string }[];
};

type Props = {
  variant: EmailVariant;
  onSelect: (variant: EmailVariant, lang?: string) => void;
  selected?: boolean;
};

export function EmailCard({ variant, onSelect, selected }: Props) {
  const activeLangs = variant.translations.map((t) => t.language);
  const bodySnippet = variant.body?.slice(0, 150).trim();

  return (
    <div
      className={cn(
        "group relative flex flex-col rounded-xl border bg-card shadow-sm hover:shadow-md transition-all duration-200 cursor-pointer overflow-hidden",
        selected
          ? "border-primary ring-1 ring-primary/30"
          : "border-border/60 hover:border-border",
      )}
      onClick={() => onSelect(variant)}
    >
      {/* Category breadcrumb */}
      {(variant.category || variant.subcategory) && (
        <div className="flex items-center gap-1 px-4 pt-3">
          {variant.category && (
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/50">
              {variant.category.replace(/-/g, " ")}
            </span>
          )}
          {variant.subcategory && (
            <>
              <span className="text-[10px] text-muted-foreground/30">›</span>
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/50">
                {variant.subcategory.replace(/-/g, " ")}
              </span>
            </>
          )}
        </div>
      )}

      {/* Template name */}
      <h3
        className={cn(
          "px-4 pt-2 pb-3 text-sm font-semibold leading-snug line-clamp-2 transition-colors",
          selected ? "text-primary" : "text-foreground group-hover:text-primary",
        )}
      >
        {variant.name}
      </h3>

      {/* Mini email mockup */}
      <div className="mx-4 rounded-lg border bg-muted/20 overflow-hidden">
        <div className="px-3 py-2 bg-background/60 border-b">
          <p className="text-[11px] font-semibold text-foreground leading-snug truncate">
            {variant.subject ?? (
              <span className="italic text-muted-foreground font-normal">No subject</span>
            )}
          </p>
        </div>
        <div className="px-3 py-2.5 min-h-[54px]">
          {bodySnippet ? (
            <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-2">
              {bodySnippet}
            </p>
          ) : (
            <p className="text-[11px] text-muted-foreground/40 italic">No preview available</p>
          )}
          {variant.cta && (
            <div className="mt-2">
              <span className="inline-block rounded px-2.5 py-0.5 text-[10px] font-semibold border border-primary/25 text-primary bg-primary/5 leading-5">
                {variant.cta}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div
        className="mt-3 px-4 pb-4 flex items-center justify-between gap-2"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Language pills */}
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-[10px] font-mono font-medium text-muted-foreground bg-muted rounded px-1.5 py-0.5">
            en
          </span>
          {activeLangs.slice(0, 3).map((l) => (
            <button
              key={l}
              className="text-[10px] font-mono text-muted-foreground hover:text-foreground border rounded px-1.5 py-0.5 hover:bg-muted transition-colors"
              onClick={() => onSelect(variant, l)}
            >
              {l}
            </button>
          ))}
          {activeLangs.length > 3 && (
            <span className="text-[10px] text-muted-foreground">+{activeLangs.length - 3}</span>
          )}
        </div>

        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "h-7 px-2 text-xs gap-1 shrink-0 transition-colors",
            selected
              ? "text-primary"
              : "text-muted-foreground hover:text-foreground",
          )}
          onClick={() => onSelect(variant)}
        >
          <Eye className="h-3.5 w-3.5" />
          Preview
        </Button>
      </div>
    </div>
  );
}
