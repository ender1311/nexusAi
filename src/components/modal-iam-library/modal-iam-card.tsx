"use client";

import { useState } from "react";
import { ExternalLink, Image as ImageIcon, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { LibraryDeleteButton } from "@/components/library/library-delete-button";

export type ModalIamVariant = {
  id: string;
  name: string;
  title: string | null;
  body: string;
  cta: string | null;
  deeplink: string | null;
  iconImageUrl: string | null;
  status: string;
  category: string | null;
  subcategory: string | null;
  sortOrder: number;
};

type Props = { variant: ModalIamVariant; canManage?: boolean };

export function ModalIamCard({ variant, canManage }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="relative group">
      <button
        onClick={() => setOpen(true)}
        className="group/card w-full text-left rounded-xl border bg-card hover:shadow-md transition-shadow overflow-hidden flex flex-col"
      >
        {/* Mini modal preview */}
        <div className="relative bg-[#1a1130] p-3 flex items-center justify-center min-h-[148px]">
          {/* Blurred app lines */}
          <div className="absolute inset-x-4 top-3 space-y-1 opacity-15">
            <div className="h-1 w-full rounded bg-white" />
            <div className="h-1 w-4/5 rounded bg-white" />
            <div className="h-1 w-full rounded bg-white" />
          </div>
          {/* Dark overlay */}
          <div className="absolute inset-0 bg-black/40" />
          {/* Modal card */}
          <div className="relative w-full max-w-[180px] overflow-hidden rounded-xl bg-white shadow-xl">
            {variant.iconImageUrl ? (
              <div className="aspect-video overflow-hidden bg-zinc-100">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={variant.iconImageUrl}
                  alt=""
                  className="h-full w-full object-cover"
                />
              </div>
            ) : (
              <div className="flex aspect-video items-center justify-center bg-gradient-to-br from-purple-50 to-purple-100">
                <ImageIcon className="h-5 w-5 text-purple-300" />
              </div>
            )}
            <div className="px-2.5 pb-2.5 pt-2 text-center">
              <p className="text-[9px] font-bold leading-tight text-[#1c1c1e] line-clamp-2">
                {variant.title ?? "Untitled"}
              </p>
              <p className="mt-0.5 text-[8px] leading-snug text-[#636366] line-clamp-2">
                {variant.body}
              </p>
            </div>
          </div>
          {/* X button hint */}
          <div className="absolute top-3 right-3 flex h-4 w-4 items-center justify-center rounded-full bg-white/10">
            <X className="h-2.5 w-2.5 text-white/50" />
          </div>
        </div>

        {/* Card metadata */}
        <div className="flex flex-col gap-1.5 p-3 flex-1">
          <p className="text-sm font-medium text-foreground leading-snug line-clamp-2">
            {variant.name}
          </p>
          <p className="text-xs text-muted-foreground line-clamp-1">
            {variant.title}
          </p>
          <div className="flex items-center gap-1.5 mt-auto pt-1 flex-wrap">
            <Badge
              variant={variant.status === "active" ? "default" : "secondary"}
              className="text-[10px] px-1.5 py-0"
            >
              {variant.status}
            </Badge>
            {variant.category && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                {variant.category}
              </Badge>
            )}
          </div>
        </div>
      </button>
        {canManage && (
          <LibraryDeleteButton
            apiPath="/api/modal-iam-library"
            variantId={variant.id}
            variantName={variant.name}
            className="absolute right-2 top-2 z-10 bg-card/80 opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100"
          />
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="line-clamp-2">{variant.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {/* Full preview */}
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
                  <div className="mt-3 rounded-lg bg-[#008294] px-3 py-2 text-[12px] font-semibold text-white">
                    {variant.cta ?? "Tap to Continue"}
                  </div>
                </div>
                {/* X dismiss button — matches real Braze modal */}
                <div className="absolute top-2.5 right-2.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/10">
                  <X className="h-3 w-3 text-[#1c1c1e]/50" />
                </div>
              </div>
            </div>

            {/* Fields */}
            <div className="space-y-3 text-sm">
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-0.5">Title</p>
                <p className="text-foreground">{variant.title ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-0.5">Body</p>
                <p className="text-foreground">{variant.body}</p>
              </div>
              {variant.deeplink && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-0.5">Deeplink</p>
                  <a
                    href={variant.deeplink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-xs font-mono text-primary hover:underline break-all"
                  >
                    <ExternalLink className="h-3 w-3 shrink-0" />
                    {variant.deeplink}
                  </a>
                </div>
              )}
              <div className="flex items-center gap-2 flex-wrap">
                {variant.category && (
                  <Badge variant="secondary">{variant.category}</Badge>
                )}
                {variant.subcategory && (
                  <Badge variant="outline">{variant.subcategory}</Badge>
                )}
                <Badge variant={variant.status === "active" ? "default" : "secondary"}>
                  {variant.status}
                </Badge>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
