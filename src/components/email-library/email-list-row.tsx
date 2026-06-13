"use client";

import { Button } from "@/components/ui/button";
import { Eye, Mail } from "lucide-react";
import { cn } from "@/lib/utils";
import type { EmailVariant } from "./email-card";

type Props = {
  variant: EmailVariant;
  onSelect: (variant: EmailVariant, lang?: string) => void;
  selected?: boolean;
};

export function EmailListRow({ variant, onSelect, selected }: Props) {
  const activeLangs = variant.translations.map((t) => t.language);

  const catLabel = [variant.category, variant.subcategory]
    .filter(Boolean)
    .map((s) => s!.replace(/-/g, " "))
    .join(" · ");

  return (
    <div
      className={cn(
        "group flex items-center gap-3 px-4 py-3 border-b last:border-0 cursor-pointer transition-colors",
        selected ? "bg-primary/5" : "hover:bg-muted/30",
      )}
      onClick={() => onSelect(variant)}
    >
      {/* Icon */}
      <Mail
        className={cn(
          "h-4 w-4 shrink-0",
          selected ? "text-primary" : "text-muted-foreground",
        )}
      />

      {/* Name + subject */}
      <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-0 sm:gap-4 items-center">
        <p
          className={cn(
            "text-sm font-medium truncate transition-colors",
            selected ? "text-primary" : "text-foreground group-hover:text-primary",
          )}
        >
          {variant.name}
        </p>
        <p className="text-xs text-muted-foreground truncate">
          {variant.subject ?? <span className="italic">No subject</span>}
        </p>
      </div>

      {/* Category (hidden on mobile) */}
      {catLabel && (
        <span className="hidden lg:block text-[10px] text-muted-foreground/60 uppercase tracking-wide shrink-0 max-w-[140px] truncate">
          {catLabel}
        </span>
      )}

      {/* Languages */}
      <div
        className="flex items-center gap-1 shrink-0"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="text-[10px] font-mono text-muted-foreground bg-muted rounded px-1.5 py-0.5">
          en
        </span>
        {activeLangs.slice(0, 2).map((l) => (
          <button
            key={l}
            className="hidden sm:block text-[10px] font-mono text-muted-foreground hover:text-foreground border rounded px-1.5 py-0.5 hover:bg-muted transition-colors"
            onClick={() => onSelect(variant, l)}
          >
            {l}
          </button>
        ))}
        {activeLangs.length > 2 && (
          <span className="hidden sm:block text-[10px] text-muted-foreground">
            +{activeLangs.length - 2}
          </span>
        )}
        {activeLangs.length > 0 && (
          <span className="sm:hidden text-[10px] text-muted-foreground">
            +{activeLangs.length}
          </span>
        )}
      </div>

      {/* Preview button */}
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={(e) => {
          e.stopPropagation();
          onSelect(variant);
        }}
      >
        <Eye className="h-4 w-4" />
      </Button>
    </div>
  );
}
