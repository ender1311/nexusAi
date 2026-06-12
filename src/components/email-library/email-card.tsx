"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Mail, Globe, Eye } from "lucide-react";

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

export function EmailCard({ variant }: { variant: EmailVariant }) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewLang, setPreviewLang] = useState("en");
  const [loading, setLoading] = useState(false);

  const activeLangs = variant.translations.map((t) => t.language);

  async function openPreview(lang: string) {
    setPreviewLang(lang);
    setPreviewOpen(true);
    if (previewHtml !== null && lang === "en") return;
    setLoading(true);
    try {
      const res = await fetch(`/api/email-library?id=${variant.id}`, { method: "PATCH" });
      const json = await res.json();
      if (lang === "en") {
        setPreviewHtml(json.data?.htmlBody ?? "<p>No HTML available</p>");
      } else {
        const t = json.data?.translations?.find((x: { language: string; htmlBody: string | null }) => x.language === lang);
        setPreviewHtml(t?.htmlBody ?? "<p>No HTML available for this language</p>");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Card className="flex flex-col overflow-hidden">
        <CardContent className="flex-1 p-4 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-medium leading-tight">{variant.name}</p>
            <div className="flex shrink-0 items-center gap-1">
              {activeLangs.length > 0 && (
                <Badge variant="secondary" className="text-xs gap-1">
                  <Globe className="h-3 w-3" />
                  {activeLangs.length}
                </Badge>
              )}
              {variant.subcategory && (
                <Badge variant="outline" className="text-xs">{variant.subcategory}</Badge>
              )}
            </div>
          </div>

          <div className="rounded-md border bg-muted/30 p-3 space-y-1">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Mail className="h-3.5 w-3.5 shrink-0" />
              <span className="font-medium">Subject:</span>
              <span className="truncate">{variant.subject ?? "—"}</span>
            </div>
          </div>

          {variant.deeplink && (
            <p className="text-xs font-mono text-muted-foreground truncate">{variant.deeplink}</p>
          )}
        </CardContent>

        <CardFooter className="px-4 pb-4 pt-0 flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 gap-1"
            onClick={() => openPreview("en")}
          >
            <Eye className="h-3.5 w-3.5" />
            Preview
          </Button>
          {activeLangs.length > 0 && (
            <select
              className="h-8 rounded-md border bg-background px-2 text-xs"
              defaultValue=""
              onChange={(e) => { if (e.target.value) openPreview(e.target.value); }}
              aria-label="Preview language"
            >
              <option value="">Lang…</option>
              {activeLangs.map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
          )}
        </CardFooter>
      </Card>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col p-0">
          <DialogHeader className="px-6 pt-6 pb-4 border-b shrink-0">
            <DialogTitle className="text-sm font-medium">
              {variant.name}
              {previewLang !== "en" && <Badge variant="secondary" className="ml-2">{previewLang}</Badge>}
            </DialogTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Subject: {previewLang === "en"
                ? (variant.subject ?? "—")
                : (variant.translations.find(t => t.language === previewLang)?.subject ?? "—")}
            </p>
          </DialogHeader>
          <div className="flex-1 overflow-auto p-0">
            {loading ? (
              <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">
                Loading…
              </div>
            ) : previewHtml ? (
              <iframe
                srcDoc={previewHtml}
                className="w-full h-full min-h-[600px] border-0"
                sandbox="allow-same-origin"
                title="Email preview"
              />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
