"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PushNotificationPreview } from "@/components/agents/push-notification-preview";
import {
  buildSpecificVerseDeeplink,
  GENERIC_BIBLE_DEEPLINK,
  isSpecificVerseDeeplink,
  parseUsfmFromDeeplink,
  type SpecificVerseDeeplinkMode,
} from "@/lib/push-deeplinks";
import { cn } from "@/lib/utils";
import { PUSH_CATEGORY_VALUES, PUSH_SUBCATEGORIES } from "@/lib/push-categories";

const CATEGORIES = PUSH_CATEGORY_VALUES;
const SUBCATEGORIES = PUSH_SUBCATEGORIES;

type TemplateVariant = {
  id: string;
  name: string;
  title: string | null;
  body: string;
  deeplink: string | null;
  cta: string | null;
  category: string | null;
  subcategory: string | null;
};

type Props =
  | { mode: "create"; variant?: undefined; children: React.ReactNode }
  | { mode: "edit"; variant: TemplateVariant; children: React.ReactNode };

export function TemplateFormSheet({ mode, variant, children }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [name, setName] = useState(variant?.name ?? "");
  const [category, setCategory] = useState(variant?.category ?? "");
  const [subcategory, setSubcategory] = useState(variant?.subcategory ?? "");
  const [title, setTitle] = useState(variant?.title ?? "");
  const [body, setBody] = useState(variant?.body ?? "");
  const [deeplink, setDeeplink] = useState(variant?.deeplink ?? "");
  const [cta, setCta] = useState(variant?.cta ?? "");

  // Only meaningful when subcategory === "specific-verse"
  const [svMode, setSvMode] = useState<SpecificVerseDeeplinkMode>(
    variant?.subcategory === "specific-verse" && isSpecificVerseDeeplink(variant?.deeplink)
      ? "specific"
      : "generic"
  );
  const [svUsfm, setSvUsfm] = useState(
    isSpecificVerseDeeplink(variant?.deeplink)
      ? (parseUsfmFromDeeplink(variant?.deeplink) ?? "")
      : ""
  );

  const subcategoryOptions = SUBCATEGORIES[category] ?? [];

  function resetForm() {
    if (mode === "create") {
      setName("");
      setCategory("");
      setSubcategory("");
      setTitle("");
      setBody("");
      setDeeplink("");
      setCta("");
      setSvMode("generic");
      setSvUsfm("");
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setFormError(null);

    const effectiveDeeplink =
      subcategory === "specific-verse"
        ? (svMode === "generic"
            ? GENERIC_BIBLE_DEEPLINK
            : (svUsfm.trim() ? buildSpecificVerseDeeplink(svUsfm.trim()) : null))
        : (deeplink.trim() || null);

    try {
      let res: Response;
      if (mode === "create") {
        res = await fetch("/api/push-library", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            category,
            subcategory: subcategory || undefined,
            title: title || undefined,
            body,
            deeplink: effectiveDeeplink ?? undefined,
            cta: cta || undefined,
          }),
        });
      } else {
        res = await fetch(`/api/variants/${variant.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            title: title || null,
            body,
            deeplink: effectiveDeeplink,
            cta: cta || null,
            category,
          }),
        });
      }
      if (!res.ok) throw new Error("Request failed");
      setOpen(false);
      resetForm();
      router.refresh();
    } catch {
      setFormError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) { resetForm(); setFormError(null); }
      }}
    >
      <SheetTrigger render={<span />}>{children}</SheetTrigger>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto flex flex-col">
        <SheetHeader className="pb-2">
          <SheetTitle>
            {mode === "create" ? "New Push" : "Edit Push"}
          </SheetTitle>
        </SheetHeader>
        <form onSubmit={handleSubmit} className="space-y-5 mt-6 flex-1 pb-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. A — Consistency"
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="category">Category</Label>
            <Select
              value={category}
              onValueChange={(v) => {
                setCategory(v ?? "");
                setSubcategory("");
              }}
            >
              <SelectTrigger id="category">
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {subcategoryOptions.length > 0 && (
            <div className="space-y-1.5">
              <Label htmlFor="subcategory">Subcategory</Label>
              <Select
                value={subcategory}
                onValueChange={(v) => setSubcategory(v ?? "")}
              >
                <SelectTrigger id="subcategory">
                  <SelectValue placeholder="Select subcategory" />
                </SelectTrigger>
                <SelectContent>
                  {subcategoryOptions.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Push notification title"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="body">Body</Label>
            <Textarea
              id="body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Push body copy"
              rows={3}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="deeplink">Deeplink</Label>
            {subcategory === "specific-verse" ? (
              <div className="space-y-2">
                <div className="flex rounded-md border overflow-hidden text-xs">
                  <button
                    type="button"
                    className={cn(
                      "px-3 py-1.5 font-medium transition-colors",
                      svMode === "generic"
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                    onClick={() => setSvMode("generic")}
                  >
                    Generic
                  </button>
                  <button
                    type="button"
                    className={cn(
                      "px-3 py-1.5 font-medium transition-colors border-l",
                      svMode === "specific"
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                    onClick={() => setSvMode("specific")}
                  >
                    Specific Verse
                  </button>
                </div>
                {svMode === "specific" && (
                  <Input
                    value={svUsfm}
                    onChange={(e) => setSvUsfm(e.target.value)}
                    placeholder="e.g. MAT.1.1 or JHN.1.1-15"
                  />
                )}
                <p className="text-xs font-mono text-muted-foreground break-all">
                  {svMode === "generic"
                    ? "youversion://bible"
                    : svUsfm
                    ? `youversion://bible?reference=${svUsfm}`
                    : "—"}
                </p>
              </div>
            ) : (
              <Input
                id="deeplink"
                value={deeplink}
                onChange={(e) => setDeeplink(e.target.value)}
                placeholder="youversion://bible or https://..."
              />
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cta">CTA (optional)</Label>
            <Input
              id="cta"
              value={cta}
              onChange={(e) => setCta(e.target.value)}
              placeholder="Button label"
            />
          </div>

          {/* Live preview */}
          <div className="space-y-1.5">
            <Label>Preview</Label>
            <PushNotificationPreview
              title={title || undefined}
              body={body || "Your message body will appear here."}
              deeplink={
                subcategory === "specific-verse"
                  ? (svMode === "generic"
                      ? GENERIC_BIBLE_DEEPLINK
                      : (svUsfm ? buildSpecificVerseDeeplink(svUsfm) : undefined))
                  : (deeplink || undefined)
              }
            />
          </div>

          {formError && <p className="text-sm text-destructive">{formError}</p>}
          <SheetFooter className="pt-2">
            <Button type="submit" disabled={loading} className="w-full">
              {loading
                ? mode === "create"
                  ? "Creating…"
                  : "Saving…"
                : mode === "create"
                ? "Create Push"
                : "Save Changes"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
