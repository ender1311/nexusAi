"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ExternalLink, Layout } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ContentCardVariant } from "./content-card-card";

export function ContentCardListRow({ variant }: { variant: ContentCardVariant }) {
  const [open, setOpen] = useState(false);

  const catLabel = [variant.category, variant.subcategory]
    .filter(Boolean)
    .map((s) => s!.replace(/-/g, " "))
    .join(" · ");

  return (
    <>
      <div
        className="group flex items-center gap-3 px-4 py-3 border-b last:border-0 hover:bg-muted/30 cursor-pointer transition-colors"
        onClick={() => setOpen(true)}
      >
        {/* Icon */}
        <div className="h-1.5 w-1.5 rounded-full bg-primary/60 shrink-0" />

        {/* Name + body stacked (mobile) / side by side (desktop) */}
        <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-0 sm:gap-4 items-center">
          <p className="text-sm font-medium text-foreground truncate group-hover:text-primary transition-colors">
            {variant.name}
          </p>
          <p className="text-xs text-muted-foreground truncate">
            {variant.title
              ? <span className="font-medium text-foreground/70">{variant.title}</span>
              : <span className="italic">No title</span>}
            {variant.title && variant.body && (
              <span className="text-muted-foreground/50"> · </span>
            )}
            {variant.body && (
              <span>{variant.body.slice(0, 80)}{variant.body.length > 80 ? "…" : ""}</span>
            )}
          </p>
        </div>

        {/* Category */}
        {catLabel && (
          <span className="hidden lg:block text-[10px] text-muted-foreground/60 uppercase tracking-wide shrink-0 max-w-[140px] truncate">
            {catLabel}
          </span>
        )}

        {/* CTA pill */}
        {variant.cta && (
          <span className="hidden sm:inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-medium border border-primary/20 text-primary bg-primary/5 shrink-0">
            {variant.cta}
          </span>
        )}

        {/* Link indicator */}
        {variant.deeplink && (
          <ExternalLink className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0 hidden sm:block" />
        )}
      </div>

      {/* Detail dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold pr-6">{variant.name}</DialogTitle>
          </DialogHeader>

          <div className="rounded-xl border bg-background shadow-sm overflow-hidden">
            <div className="flex items-center gap-1.5 px-4 py-2 bg-muted/40 border-b">
              <div className="h-1.5 w-1.5 rounded-full bg-primary/60" />
              <span className="text-[9px] font-medium uppercase tracking-widest text-muted-foreground/50">
                Content Card — Classic
              </span>
            </div>
            <div className="px-4 py-4 space-y-2">
              {variant.title ? (
                <p className="text-sm font-semibold text-foreground leading-snug">{variant.title}</p>
              ) : (
                <p className="text-sm font-semibold text-muted-foreground/40 italic">No title</p>
              )}
              <p className="text-sm text-muted-foreground leading-relaxed">{variant.body}</p>
              {variant.cta && (
                <div className="pt-1">
                  <span className="inline-flex items-center gap-1 rounded-md px-3 py-1 text-xs font-semibold border border-primary/30 text-primary bg-primary/5">
                    {variant.cta}
                    <ExternalLink className="h-3 w-3" />
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="rounded-lg border bg-muted/30 p-3 space-y-2 text-xs font-mono">
            <p className="text-[10px] font-sans font-semibold uppercase tracking-wide text-muted-foreground mb-1">
              API Trigger Properties
            </p>
            {[
              { label: "title", value: variant.title },
              { label: "message", value: variant.body },
              { label: "cta", value: variant.cta },
              { label: "link", value: variant.deeplink },
            ].map(({ label, value }) => (
              <div key={label} className="flex gap-2">
                <span className={cn("shrink-0 text-muted-foreground/60", !value && "opacity-40")}>{label}:</span>
                <span className={cn("truncate", value ? "text-foreground" : "italic text-muted-foreground/40")}>
                  {value ?? "null"}
                </span>
              </div>
            ))}
          </div>

          {catLabel && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Layout className="h-3.5 w-3.5" />
              <span>{catLabel}</span>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
