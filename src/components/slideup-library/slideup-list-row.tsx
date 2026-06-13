"use client";

import { useState } from "react";
import { ExternalLink, Image as ImageIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { SlideupVariant } from "./slideup-card";

type Props = { variant: SlideupVariant };

export function SlideupListRow({ variant }: Props) {
  const [open, setOpen] = useState(false);
  const slideupOnly = !variant.title;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="w-full text-left flex items-center gap-3 px-4 py-3 border-b last:border-0 hover:bg-muted/40 transition-colors"
      >
        {variant.iconImageUrl ? (
          <img src={variant.iconImageUrl} alt="" className="w-7 h-7 rounded-md object-cover shrink-0" />
        ) : (
          <div className="w-7 h-7 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
            <ImageIcon className="w-3.5 h-3.5 text-primary/40" />
          </div>
        )}
        <span className="font-medium text-sm truncate min-w-0 flex-1">{variant.name}</span>
        <span className="text-xs text-muted-foreground truncate hidden sm:block max-w-[280px]">
          {variant.body}
        </span>
        <div className="flex items-center gap-1.5 shrink-0">
          {slideupOnly && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800">
              slideup only
            </Badge>
          )}
          {variant.category && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
              {variant.category}
            </Badge>
          )}
        </div>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{variant.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {/* Slideup mockup */}
            <div className="rounded-lg bg-gradient-to-b from-slate-100 to-slate-200 dark:from-slate-800 dark:to-slate-900 p-4 flex items-end min-h-[90px]">
              <div className="w-full bg-white dark:bg-slate-950 rounded-xl shadow-lg flex items-center gap-3 px-3 py-2.5 border">
                {variant.iconImageUrl ? (
                  <img src={variant.iconImageUrl} alt="" className="w-12 h-12 rounded-lg object-cover shrink-0" />
                ) : (
                  <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <ImageIcon className="w-5 h-5 text-primary/40" />
                  </div>
                )}
                <p className="text-sm leading-tight text-foreground">{variant.body}</p>
              </div>
            </div>
            <dl className="space-y-2 text-sm">
              <div className="flex gap-2">
                <dt className="text-muted-foreground shrink-0 w-20">Type</dt>
                <dd>{slideupOnly ? "Slideup only" : "Push + Slideup"}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-muted-foreground shrink-0 w-20">Message</dt>
                <dd className="text-foreground">{variant.body}</dd>
              </div>
              {variant.title && (
                <div className="flex gap-2">
                  <dt className="text-muted-foreground shrink-0 w-20">Push title</dt>
                  <dd className="text-foreground">{variant.title}</dd>
                </div>
              )}
              {variant.deeplink && (
                <div className="flex gap-2">
                  <dt className="text-muted-foreground shrink-0 w-20">Link</dt>
                  <dd className="break-all text-foreground flex items-center gap-1">
                    <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
                    {variant.deeplink}
                  </dd>
                </div>
              )}
            </dl>
            <div className="rounded-lg bg-muted/50 p-3 space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Canvas entry properties</p>
              <pre className="text-[10px] text-foreground overflow-x-auto whitespace-pre-wrap font-mono">
                {JSON.stringify({
                  slideupOnly,
                  ...(variant.title ? { title: variant.title } : {}),
                  message: variant.body,
                  ...(variant.deeplink ? { link: variant.deeplink } : {}),
                  ...(variant.iconImageUrl ? { imageUrl: variant.iconImageUrl } : {}),
                }, null, 2)}
              </pre>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
