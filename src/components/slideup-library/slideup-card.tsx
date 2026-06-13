"use client";

import { useState } from "react";
import { ExternalLink, Image as ImageIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export type SlideupVariant = {
  id: string;
  name: string;
  title: string | null;
  body: string;
  deeplink: string | null;
  iconImageUrl: string | null;
  status: string;
  category: string | null;
  subcategory: string | null;
  sortOrder: number;
};

type Props = { variant: SlideupVariant };

export function SlideupCard({ variant }: Props) {
  const [open, setOpen] = useState(false);
  const slideupOnly = !variant.title;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="group/card w-full text-left rounded-xl border bg-card hover:shadow-md transition-shadow overflow-hidden flex flex-col"
      >
        {/* Slideup mockup */}
        <div className="relative bg-gradient-to-b from-slate-100 to-slate-200 dark:from-slate-800 dark:to-slate-900 p-4 flex items-end min-h-[120px]">
          {/* Simulated app screen backdrop */}
          <div className="absolute inset-0 flex items-center justify-center opacity-10">
            <div className="w-8 h-8 rounded-full bg-slate-400" />
          </div>
          {/* Slideup bar */}
          <div className="relative w-full bg-white dark:bg-slate-950 rounded-xl shadow-lg flex items-center gap-3 px-3 py-2.5 border">
            {variant.iconImageUrl ? (
              <img
                src={variant.iconImageUrl}
                alt=""
                className="w-10 h-10 rounded-lg object-cover shrink-0"
              />
            ) : (
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <ImageIcon className="w-4 h-4 text-primary/40" />
              </div>
            )}
            <p className="text-[10px] leading-tight text-foreground line-clamp-2 flex-1 min-w-0">
              {variant.body}
            </p>
          </div>
          {slideupOnly && (
            <span className="absolute top-2 right-2 text-[9px] font-medium bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded-full">
              slideup only
            </span>
          )}
        </div>

        {/* Meta */}
        <div className="p-3 space-y-1.5 flex-1">
          <p className="text-sm font-medium leading-tight line-clamp-1 group-hover/card:text-primary transition-colors">
            {variant.name}
          </p>
          {variant.title && (
            <p className="text-xs text-muted-foreground line-clamp-1">
              Push: {variant.title}
            </p>
          )}
          <div className="flex items-center gap-1.5 flex-wrap">
            {variant.category && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                {variant.category}
              </Badge>
            )}
            {variant.subcategory && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                {variant.subcategory}
              </Badge>
            )}
          </div>
        </div>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{variant.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <SlideupMockup variant={variant} />
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
              {variant.iconImageUrl && (
                <div className="flex gap-2">
                  <dt className="text-muted-foreground shrink-0 w-20">Image</dt>
                  <dd className="break-all text-foreground text-xs">{variant.iconImageUrl}</dd>
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

function SlideupMockup({ variant }: { variant: SlideupVariant }) {
  return (
    <div className={cn("rounded-lg bg-gradient-to-b from-slate-100 to-slate-200 dark:from-slate-800 dark:to-slate-900 p-4 flex items-end min-h-[100px]")}>
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
  );
}
