"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Eye, Mail } from "lucide-react";
import { cn } from "@/lib/utils";
import type { EmailVariant } from "./email-card";

type HtmlCache = { en: string; langs: Record<string, string> };

export function EmailListRow({ variant }: { variant: EmailVariant }) {
  const [open, setOpen] = useState(false);
  const [lang, setLang] = useState("en");
  const [cache, setCache] = useState<HtmlCache | null>(null);
  const [loading, setLoading] = useState(false);

  const activeLangs = variant.translations.map((t) => t.language);
  const allLangs = ["en", ...activeLangs];

  async function ensureLoaded(): Promise<HtmlCache> {
    if (cache) return cache;
    setLoading(true);
    try {
      const res = await fetch(`/api/email-library?id=${variant.id}`, { method: "PATCH" });
      const json = await res.json();
      const langs: Record<string, string> = {};
      for (const t of (json.data?.translations ?? []) as { language: string; htmlBody: string | null }[]) {
        langs[t.language] = t.htmlBody ?? "";
      }
      const loaded: HtmlCache = { en: json.data?.htmlBody ?? "", langs };
      setCache(loaded);
      return loaded;
    } finally {
      setLoading(false);
    }
  }

  async function openPreview(l = "en") {
    setLang(l);
    setOpen(true);
    await ensureLoaded();
  }

  async function switchLang(l: string) {
    setLang(l);
    await ensureLoaded();
  }

  function currentHtml(): string | null {
    if (!cache) return null;
    const h = lang === "en" ? cache.en : (cache.langs[lang] ?? "");
    return h || null;
  }

  const currentSubject =
    lang === "en"
      ? (variant.subject ?? "—")
      : (variant.translations.find((t) => t.language === lang)?.subject ?? "—");

  const catLabel = [variant.category, variant.subcategory]
    .filter(Boolean)
    .map((s) => s!.replace(/-/g, " "))
    .join(" · ");

  return (
    <>
      <div
        className="group flex items-center gap-3 px-4 py-3 border-b last:border-0 hover:bg-muted/30 cursor-pointer transition-colors"
        onClick={() => openPreview("en")}
      >
        {/* Icon */}
        <Mail className="h-4 w-4 text-muted-foreground shrink-0" />

        {/* Name + subject stacked (mobile) / side by side (desktop) */}
        <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-0 sm:gap-4 items-center">
          <p className="text-sm font-medium text-foreground truncate group-hover:text-primary transition-colors">
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
        <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
          <span className="text-[10px] font-mono text-muted-foreground bg-muted rounded px-1.5 py-0.5">
            en
          </span>
          {activeLangs.slice(0, 2).map((l) => (
            <button
              key={l}
              className="hidden sm:block text-[10px] font-mono text-muted-foreground hover:text-foreground border rounded px-1.5 py-0.5 hover:bg-muted transition-colors"
              onClick={() => openPreview(l)}
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
            <span className="sm:hidden text-[10px] text-muted-foreground">+{activeLangs.length}</span>
          )}
        </div>

        {/* Preview button */}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={(e) => { e.stopPropagation(); openPreview("en"); }}
        >
          <Eye className="h-4 w-4" />
        </Button>
      </div>

      {/* Preview dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-4xl max-h-[92vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-6 pt-5 pb-4 border-b shrink-0 gap-1.5">
            <DialogTitle className="text-sm font-semibold leading-snug pr-6">{variant.name}</DialogTitle>
            {allLangs.length > 1 && (
              <div className="flex items-center gap-1 flex-wrap pt-0.5">
                {allLangs.map((l) => (
                  <button
                    key={l}
                    onClick={() => switchLang(l)}
                    className={cn(
                      "px-2.5 py-0.5 rounded-md text-[11px] font-mono font-medium transition-colors",
                      lang === l
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted",
                    )}
                  >
                    {l}
                  </button>
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground/80">Subject:</span> {currentSubject}
            </p>
          </DialogHeader>

          <div className="flex-1 overflow-hidden">
            {loading ? (
              <div className="flex items-center justify-center h-64 text-sm text-muted-foreground">
                Loading preview…
              </div>
            ) : currentHtml() ? (
              <iframe
                key={lang}
                srcDoc={currentHtml()!}
                className="w-full h-full min-h-[600px] border-0"
                sandbox="allow-same-origin"
                title={`Email preview — ${lang}`}
              />
            ) : open && !loading ? (
              <div className="flex items-center justify-center h-64 text-sm text-muted-foreground">
                No HTML available for {lang}
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
