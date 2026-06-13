"use client";

import { useState } from "react";
import { ExternalLink, Image as ImageIcon, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { ModalIamVariant } from "./modal-iam-card";

type Props = { variant: ModalIamVariant };

export function ModalIamListRow({ variant }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="w-full text-left flex items-center gap-3 px-4 py-3 border-b last:border-0 hover:bg-muted/40 transition-colors"
      >
        {variant.iconImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={variant.iconImageUrl} alt={variant.name} className="w-7 h-7 rounded-md object-cover shrink-0" />
        ) : (
          <div className="w-7 h-7 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
            <ImageIcon className="w-3.5 h-3.5 text-primary/40" />
          </div>
        )}
        <span className="font-medium text-sm truncate min-w-0 flex-1">{variant.name}</span>
        <span className="text-xs text-muted-foreground truncate hidden sm:block max-w-[220px]">
          {variant.title}
        </span>
        <span className="text-xs text-muted-foreground truncate hidden md:block max-w-[240px]">
          {variant.body}
        </span>
        <div className="flex items-center gap-1.5 shrink-0">
          {variant.category && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
              {variant.category}
            </Badge>
          )}
        </div>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="line-clamp-2">{variant.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {/* Full modal preview */}
            <div className="rounded-xl bg-[#1a1130] p-5 flex items-center justify-center">
              <div className="relative w-full max-w-[260px] overflow-hidden rounded-2xl bg-white shadow-2xl">
                {variant.iconImageUrl ? (
                  <div className="aspect-video overflow-hidden bg-zinc-100">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={variant.iconImageUrl} alt={variant.name} className="h-full w-full object-cover" />
                  </div>
                ) : null}
                <div className={cn("px-4 pb-4 text-center", variant.iconImageUrl ? "pt-3" : "pt-6")}>
                  <p className="text-[14px] font-bold leading-snug text-[#1c1c1e]">
                    {variant.title ?? "Untitled"}
                  </p>
                  <p className="mt-1.5 text-[12px] leading-relaxed text-[#636366]">
                    {variant.body}
                  </p>
                  <div className="mt-3 rounded-lg bg-[#5b4fd8] px-3 py-2 text-[12px] font-semibold text-white">
                    {variant.cta ?? "Tap to Continue"}
                  </div>
                </div>
                {/* X button */}
                <div className="absolute top-2.5 right-2.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/10">
                  <X className="h-3 w-3 text-[#1c1c1e]/50" />
                </div>
              </div>
            </div>

            <dl className="space-y-2 text-sm">
              <div className="flex gap-2">
                <dt className="text-muted-foreground shrink-0 w-16">Title</dt>
                <dd className="text-foreground">{variant.title ?? "—"}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-muted-foreground shrink-0 w-16">Body</dt>
                <dd className="text-foreground">{variant.body}</dd>
              </div>
              {variant.deeplink && (
                <div className="flex gap-2">
                  <dt className="text-muted-foreground shrink-0 w-16">Link</dt>
                  <dd className="break-all text-foreground flex items-center gap-1">
                    <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
                    <a
                      href={variant.deeplink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:underline text-primary"
                    >
                      {variant.deeplink}
                    </a>
                  </dd>
                </div>
              )}
            </dl>

            <div className="flex items-center gap-2 flex-wrap">
              {variant.category && <Badge variant="secondary">{variant.category}</Badge>}
              {variant.subcategory && <Badge variant="outline">{variant.subcategory}</Badge>}
              <Badge variant={variant.status === "active" ? "default" : "secondary"}>
                {variant.status}
              </Badge>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
