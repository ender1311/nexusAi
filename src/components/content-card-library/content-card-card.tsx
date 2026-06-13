"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ExternalLink, Layout } from "lucide-react";
import { cn } from "@/lib/utils";

export type ContentCardVariant = {
  id: string;
  name: string;
  title: string | null;
  body: string;
  cta: string | null;
  deeplink: string | null;
  category: string | null;
  subcategory: string | null;
  sortOrder: number;
};

export function ContentCardCard({ variant }: { variant: ContentCardVariant }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div
        className="group relative flex flex-col rounded-xl border border-border/60 bg-card shadow-sm hover:border-border hover:shadow-md transition-all duration-200 cursor-pointer overflow-hidden"
        onClick={() => setOpen(true)}
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
        <h3 className="px-4 pt-2 pb-3 text-sm font-semibold leading-snug text-foreground group-hover:text-primary transition-colors line-clamp-2">
          {variant.name}
        </h3>

        {/* Braze-style Classic content card preview */}
        <div className="mx-4 rounded-lg border bg-background shadow-sm overflow-hidden">
          {/* Card header bar */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-muted/40 border-b">
            <div className="h-1.5 w-1.5 rounded-full bg-primary/60" />
            <span className="text-[9px] font-medium uppercase tracking-widest text-muted-foreground/50">
              Content Card
            </span>
          </div>
          <div className="px-3 py-2.5 min-h-[60px] space-y-1">
            {variant.title ? (
              <p className="text-[11px] font-semibold text-foreground leading-snug line-clamp-2">
                {variant.title}
              </p>
            ) : (
              <p className="text-[11px] font-semibold text-muted-foreground/40 italic">No title</p>
            )}
            <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-2">
              {variant.body}
            </p>
            {variant.cta && (
              <div className="pt-1">
                <span className="inline-flex items-center gap-1 rounded px-2.5 py-0.5 text-[10px] font-semibold border border-primary/25 text-primary bg-primary/5 leading-5">
                  {variant.cta}
                  <ExternalLink className="h-2.5 w-2.5" />
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="mt-3 px-4 pb-4 flex items-center justify-between gap-2">
          {variant.deeplink ? (
            <span className="text-[10px] text-muted-foreground truncate max-w-[70%]">
              {variant.deeplink}
            </span>
          ) : (
            <span className="text-[10px] text-muted-foreground/40 italic">No link</span>
          )}
          <span className="shrink-0 text-[10px] text-muted-foreground/50 group-hover:text-muted-foreground transition-colors">
            view
          </span>
        </div>
      </div>

      {/* Detail dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold pr-6">{variant.name}</DialogTitle>
          </DialogHeader>

          {/* Full-size card preview */}
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

          {/* Trigger properties */}
          <div className="rounded-lg border bg-muted/30 p-3 space-y-2 text-xs font-mono">
            <p className="text-[10px] font-sans font-semibold uppercase tracking-wide text-muted-foreground mb-1">
              API Trigger Properties
            </p>
            <TriggerProp label="title" value={variant.title} />
            <TriggerProp label="message" value={variant.body} />
            <TriggerProp label="cta" value={variant.cta} />
            <TriggerProp label="link" value={variant.deeplink} />
          </div>

          {/* Category */}
          {(variant.category || variant.subcategory) && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Layout className="h-3.5 w-3.5" />
              <span>
                {[variant.category, variant.subcategory]
                  .filter(Boolean)
                  .map((s) => s!.replace(/-/g, " "))
                  .join(" · ")}
              </span>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function TriggerProp({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex gap-2">
      <span className={cn("shrink-0 text-muted-foreground/60", value ? "" : "opacity-40")}>{label}:</span>
      <span className={cn("truncate", value ? "text-foreground" : "italic text-muted-foreground/40")}>
        {value ?? "null"}
      </span>
    </div>
  );
}
