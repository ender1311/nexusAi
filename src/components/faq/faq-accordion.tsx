"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export type FaqItem = {
  q: string;
  a: string | React.ReactNode;
};

export type FaqCategory = {
  title: string;
  emoji: string;
  items: FaqItem[];
};

function FaqEntry({ item, index }: { item: FaqItem; index: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className={cn(
        "border rounded-xl overflow-hidden transition-colors",
        open ? "border-[#57a16c]/50 bg-[#57a16c]/5" : "border-border bg-card hover:border-[#57a16c]/30"
      )}
    >
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-start justify-between gap-4 px-5 py-4 text-left"
        aria-expanded={open}
      >
        <span className="flex items-start gap-3 min-w-0">
          <span className="text-[#57a16c] font-mono text-xs font-bold shrink-0 mt-0.5 w-5 text-right">
            {String(index + 1).padStart(2, "0")}
          </span>
          <span className="text-sm font-semibold leading-snug">{item.q}</span>
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground mt-0.5 transition-transform duration-200",
            open && "rotate-180 text-[#57a16c]"
          )}
        />
      </button>
      {open && (
        <div className="px-5 pb-5 pl-[3.25rem]">
          <div className="text-sm text-muted-foreground leading-relaxed space-y-2">
            {typeof item.a === "string" ? <p>{item.a}</p> : item.a}
          </div>
        </div>
      )}
    </div>
  );
}

export function FaqAccordion({ categories }: { categories: FaqCategory[] }) {
  const [activeCategory, setActiveCategory] = useState<string>(categories[0]?.title ?? "");

  const active = categories.find((c) => c.title === activeCategory) ?? categories[0];

  let globalIndex = 0;
  const categoryStartIndices: Record<string, number> = {};
  for (const cat of categories) {
    categoryStartIndices[cat.title] = globalIndex;
    globalIndex += cat.items.length;
  }

  return (
    <div className="space-y-6">
      {/* Category tabs */}
      <div className="flex flex-wrap gap-2">
        {categories.map((cat) => (
          <button
            key={cat.title}
            onClick={() => setActiveCategory(cat.title)}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors border",
              cat.title === activeCategory
                ? "bg-[#57a16c] text-white border-[#57a16c]"
                : "text-muted-foreground border-border hover:border-[#57a16c]/40 hover:text-foreground"
            )}
          >
            <span>{cat.emoji}</span>
            <span>{cat.title}</span>
          </button>
        ))}
      </div>

      {/* Active category */}
      {active && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-xl">{active.emoji}</span>
            <h2 className="font-semibold text-base">{active.title}</h2>
            <span className="text-xs text-muted-foreground ml-auto">
              {active.items.length} questions
            </span>
          </div>
          {active.items.map((item, i) => (
            <FaqEntry
              key={i}
              item={item}
              index={categoryStartIndices[active.title]! + i}
            />
          ))}
        </div>
      )}
    </div>
  );
}
