"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Eye } from "lucide-react";
import { cn } from "@/lib/utils";

export type EmailVariant = {
  id: string;
  name: string;
  subject: string | null;
  body: string;
  deeplink: string | null;
  cta: string | null;
  category: string | null;
  subcategory: string | null;
  sortOrder: number;
  translations: { language: string; subject: string | null; status: string }[];
};

type HtmlCache = { en: string; langs: Record<string, string> };

export function EmailCard({ variant }: { variant: EmailVariant }) {
  const [open, setOpen] = useState(false);
  const [lang, setLang] = useState("en");
  const [cache, setCache] = useState<HtmlCache | null>(null);
  const [loading, setLoading] = useState(false);
  // Prevents duplicate in-flight fetches if openPreview/switchLang called concurrently.
  const loadPromiseRef = useRef<Promise<HtmlCache> | null>(null);

  const activeLangs = variant.translations.map((t) => t.language);
  const allLangs = ["en", ...activeLangs];
  const bodySnippet = variant.body?.slice(0, 150).trim();

  function ensureLoaded(): Promise<HtmlCache> {
    if (cache) return Promise.resolve(cache);
    if (loadPromiseRef.current) return loadPromiseRef.current;
    setLoading(true);
    const promise = (async () => {
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
        loadPromiseRef.current = null;
      }
    })();
    loadPromiseRef.current = promise;
    return promise;
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

  return (
    <>
      {/* Card */}
      <div
        className="group relative flex flex-col rounded-xl border border-border/60 bg-card shadow-sm hover:border-border hover:shadow-md transition-all duration-200 cursor-pointer overflow-hidden"
        onClick={() => openPreview("en")}
      >
        {/* Category breadcrumb */}
        {(variant.category || variant.subcategory) && (
          <div className="flex items-center gap-1 px-4 pt-3">
            {variant.category && (
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/50">
                {variant.category.replace(/-/g, " ")}
              </span>
            )}
            {variant.subcategory && (
              <>
                <span className="text-[10px] text-muted-foreground/30">›</span>
                <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/50">
                  {variant.subcategory.replace(/-/g, " ")}
                </span>
              </>
            )}
          </div>
        )}

        {/* Template name */}
        <h3 className="px-4 pt-2 pb-3 text-sm font-semibold leading-snug text-foreground group-hover:text-primary transition-colors line-clamp-2">
          {variant.name}
        </h3>

        {/* Mini email mockup */}
        <div className="mx-4 rounded-lg border bg-muted/20 overflow-hidden">
          <div className="px-3 py-2 bg-background/60 border-b">
            <p className="text-[11px] font-semibold text-foreground leading-snug truncate">
              {variant.subject ?? <span className="italic text-muted-foreground font-normal">No subject</span>}
            </p>
          </div>
          <div className="px-3 py-2.5 min-h-[54px]">
            {bodySnippet ? (
              <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-2">{bodySnippet}</p>
            ) : (
              <p className="text-[11px] text-muted-foreground/40 italic">No preview available</p>
            )}
            {variant.cta && (
              <div className="mt-2">
                <span className="inline-block rounded px-2.5 py-0.5 text-[10px] font-semibold border border-primary/25 text-primary bg-primary/5 leading-5">
                  {variant.cta}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div
          className="mt-3 px-4 pb-4 flex items-center justify-between gap-2"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Language pills */}
          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-[10px] font-mono font-medium text-muted-foreground bg-muted rounded px-1.5 py-0.5">
              en
            </span>
            {activeLangs.slice(0, 3).map((l) => (
              <button
                key={l}
                className="text-[10px] font-mono text-muted-foreground hover:text-foreground border rounded px-1.5 py-0.5 hover:bg-muted transition-colors"
                onClick={() => openPreview(l)}
              >
                {l}
              </button>
            ))}
            {activeLangs.length > 3 && (
              <span className="text-[10px] text-muted-foreground">+{activeLangs.length - 3}</span>
            )}
          </div>

          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs gap-1 text-muted-foreground hover:text-foreground shrink-0"
            onClick={() => openPreview("en")}
          >
            <Eye className="h-3.5 w-3.5" />
            Preview
          </Button>
        </div>
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

          <div className="flex-1 overflow-auto">
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
