"use client";

import { useState, useRef, useEffect } from "react";
import { Plus, X, Search, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SegmentOption } from "./segment-check-list";

function formatCount(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(0)}K` : String(n);
}

type Props = {
  segments: SegmentOption[];
  selected: string[];
  /** Segments that exist in the other list and cannot be added here. */
  disabledNames: Set<string>;
  onChange: (next: string[]) => void;
  emptyText?: string;
};

export function SegmentMultiSelect({ segments, selected, disabledNames, onChange, emptyText }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    function onMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  const available = segments.filter(
    (s) =>
      !selected.includes(s.name) &&
      !disabledNames.has(s.name) &&
      (search === "" || s.name.toLowerCase().includes(search.toLowerCase())),
  );

  function add(name: string) {
    onChange([...selected, name]);
    setSearch("");
    setOpen(false);
  }

  function remove(name: string) {
    onChange(selected.filter((n) => n !== name));
  }

  const getInfo = (name: string) => segments.find((s) => s.name === name);

  return (
    <div className="space-y-2" ref={containerRef}>
      {selected.length > 0 && (
        <div className="rounded-md border divide-y">
          {selected.map((name) => {
            const info = getInfo(name);
            return (
              <div key={name} className="flex items-center gap-2 px-3 py-2">
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium truncate">{name}</span>
                  {info && (
                    <span className="block text-xs text-muted-foreground">
                      {formatCount(info.userCount)} users
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => remove(name)}
                  className="shrink-0 p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {selected.length === 0 && !open && (
        <p className="text-xs text-muted-foreground italic">
          {emptyText ?? "No segments selected"}
        </p>
      )}

      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className={cn(
            "flex items-center gap-1.5 text-sm border rounded-md px-2.5 py-1.5 transition-colors",
            open
              ? "border-primary text-foreground bg-muted/30"
              : "text-muted-foreground hover:text-foreground hover:border-foreground/30",
          )}
        >
          <Plus className="h-3.5 w-3.5" />
          Add segment
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform ml-0.5", open && "rotate-180")} />
        </button>

        {open && (
          <div className="absolute top-full mt-1 left-0 z-50 bg-popover border rounded-md shadow-md w-80">
            <div className="flex items-center gap-2 px-3 py-2 border-b">
              <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <input
                ref={searchRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search segments…"
                className="flex-1 text-sm outline-none bg-transparent placeholder:text-muted-foreground"
              />
            </div>
            <div className="max-h-60 overflow-y-auto">
              {available.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6 px-3">
                  {search ? `No segments matching "${search}"` : "No segments available"}
                </p>
              ) : (
                available.map((s) => (
                  <button
                    key={s.name}
                    type="button"
                    onClick={() => add(s.name)}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-muted/50 transition-colors border-b last:border-b-0"
                  >
                    <span className="block font-medium truncate">{s.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {formatCount(s.userCount)} users
                      {s.assignedTo ? ` · also targeted by ${s.assignedTo}` : ""}
                    </span>
                  </button>
                ))
              )}
            </div>
            <div className="border-t px-3 py-1.5 text-[11px] text-muted-foreground">
              {segments.length} segment{segments.length !== 1 ? "s" : ""} in DB
              {disabledNames.size > 0 && ` · ${disabledNames.size} in other list`}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
