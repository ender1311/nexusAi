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

export function AddLanguageDrawer({ campaign, language, enVerseRefs, onClose, onSaved }: Props) {
  const [step, setStep] = useState<"code" | "translate">("code");
  const [langCode, setLangCode] = useState(language ?? "");
  const [translations, setTranslations] = useState<Translations>({});
  const [saving, setSaving] = useState(false);

  function setField(ref: string, field: "aTitle" | "bTitle" | "verseText", value: string) {
    setTranslations((prev) => {
      const existing = prev[ref] ?? { aTitle: "", bTitle: "", verseText: "" };
      return {
        ...prev,
        [ref]: { ...existing, [field]: value },
      };
    });
  }

  async function handleSave() {
    setSaving(true);
    const tasks: Promise<Response>[] = [];

    for (const [usfmReference, vals] of Object.entries(translations)) {
      if (vals.aTitle.trim()) {
        tasks.push(
          fetch("/api/campaign-content", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              campaign,
              language: langCode,
              usfmReference,
              contentType: "a-title",
              title: vals.aTitle.trim(),
            }),
          })
        );
      }
      if (vals.bTitle.trim()) {
        tasks.push(
          fetch("/api/campaign-content", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              campaign,
              language: langCode,
              usfmReference,
              contentType: "b-title",
              title: vals.bTitle.trim(),
            }),
          })
        );
      }
      if (vals.verseText.trim()) {
        tasks.push(
          fetch("/api/campaign-content", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              campaign,
              language: langCode,
              usfmReference,
              contentType: "verse-text",
              body: vals.verseText.trim(),
            }),
          })
        );
      }
    }

    await Promise.all(tasks);
    setSaving(false);
    onSaved();
  }

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-[640px] sm:max-w-2xl overflow-y-auto">
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
          <div className="mt-6 space-y-4">
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

            <div className="space-y-6 pb-24">
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

            <div className="fixed bottom-0 right-0 w-[640px] flex justify-end gap-2 bg-background border-t px-6 py-3">
              <Button variant="outline" onClick={onClose} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? "Saving…" : "Save Translations"}
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
