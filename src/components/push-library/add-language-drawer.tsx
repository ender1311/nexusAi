"use client";

import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type EnVerseRef = {
  usfmReference: string;
  usfmHuman: string;
  enATitle?: string;
  enBTitle?: string;
  enVerseText?: string;
};

type Props = {
  campaign: string;
  language?: string;
  enVerseRefs: EnVerseRef[];
  onClose: () => void;
  onSaved: () => void;
};

type Translations = Record<string, { aTitle: string; bTitle: string; verseText: string }>;

async function postContent(
  campaign: string,
  language: string,
  usfmReference: string,
  usfmHuman: string | null | undefined,
  contentType: "a-title" | "b-title" | "verse-text",
  text: string
): Promise<void> {
  const isTitle = contentType !== "verse-text";
  const response = await fetch("/api/campaign-content", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      campaign,
      language,
      usfmReference,
      usfmHuman: usfmHuman ?? undefined,
      contentType,
      ...(isTitle ? { title: text } : { body: text }),
    }),
  });
  if (!response.ok) throw new Error(`Failed to save ${contentType} for ${usfmReference}`);
}

export function AddLanguageDrawer({ campaign, language, enVerseRefs, onClose, onSaved }: Props) {
  const [step, setStep] = useState<"code" | "translate">("code");
  const [langCode, setLangCode] = useState(language ?? "");
  const [translations, setTranslations] = useState<Translations>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setField(ref: string, field: "aTitle" | "bTitle" | "verseText", value: string) {
    setTranslations((prev) => {
      const existing = prev[ref] ?? { aTitle: "", bTitle: "", verseText: "" };
      return {
        ...prev,
        [ref]: { ...existing, [field]: value },
      };
    });
  }

  async function runBatched(fns: (() => Promise<void>)[], batchSize = 20): Promise<void> {
    for (let i = 0; i < fns.length; i += batchSize) {
      await Promise.all(fns.slice(i, i + batchSize).map((fn) => fn()));
    }
  }

  async function handleSave() {
    setSaving(true);
    const tasks: (() => Promise<void>)[] = [];

    for (const [usfmReference, vals] of Object.entries(translations)) {
      const ref = enVerseRefs.find((r) => r.usfmReference === usfmReference);
      if (vals.aTitle.trim()) {
        tasks.push(() => postContent(campaign, langCode, usfmReference, ref?.usfmHuman, "a-title", vals.aTitle.trim()));
      }
      if (vals.bTitle.trim()) {
        tasks.push(() => postContent(campaign, langCode, usfmReference, ref?.usfmHuman, "b-title", vals.bTitle.trim()));
      }
      if (vals.verseText.trim()) {
        tasks.push(() => postContent(campaign, langCode, usfmReference, ref?.usfmHuman, "verse-text", vals.verseText.trim()));
      }
    }

    try {
      await runBatched(tasks);
      setError(null);
      onSaved();
    } catch {
      setError("Save failed. Please try again.");
      setSaving(false);
    }
  }

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="flex flex-col w-full sm:w-[640px] sm:max-w-[640px] overflow-hidden">
        <SheetHeader>
          <SheetTitle>Add Language</SheetTitle>
        </SheetHeader>

        {step === "code" ? (
          <div className="mt-6 space-y-4">
            <div className="space-y-1.5">
              <Label>ISO Language Code</Label>
              <Input
                value={langCode}
                onChange={(e) => setLangCode(e.target.value.trim())}
                placeholder="e.g. pt-BR, de, zh_CN, fr"
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                This must match the language code used in your YAML files.
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button disabled={!langCode} onClick={() => setStep("translate")}>
                Continue
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto p-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">
                    Language: <strong>{langCode}</strong> — fill in translations. Partial saves are fine.
                  </p>
                  <button
                    className="text-xs text-muted-foreground hover:underline"
                    onClick={() => setStep("code")}
                  >
                    Change code
                  </button>
                </div>

                <div className="space-y-6">
                  {enVerseRefs.map((ref) => (
                    <div key={ref.usfmReference} className="border rounded-lg p-3 space-y-3">
                      <p className="text-sm font-medium">{ref.usfmHuman}</p>
                      <div className="space-y-1">
                        <Label className="text-xs">A-Title</Label>
                        <Input
                          value={translations[ref.usfmReference]?.aTitle ?? ""}
                          onChange={(e) => setField(ref.usfmReference, "aTitle", e.target.value)}
                          placeholder={ref.enATitle ?? ""}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">B-Title</Label>
                        <Input
                          value={translations[ref.usfmReference]?.bTitle ?? ""}
                          onChange={(e) => setField(ref.usfmReference, "bTitle", e.target.value)}
                          placeholder={ref.enBTitle ?? ""}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Verse Text</Label>
                        <Input
                          value={translations[ref.usfmReference]?.verseText ?? ""}
                          onChange={(e) => setField(ref.usfmReference, "verseText", e.target.value)}
                          placeholder={ref.enVerseText ?? ""}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="border-t p-4 flex justify-end gap-2 bg-background">
              {error && <p className="text-sm text-destructive mr-auto">{error}</p>}
              <Button variant="outline" onClick={onClose} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? "Saving…" : "Save Translations"}
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
