"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

type Props = {
  campaign: string;
  language: string;
  usfmReference: string;
  usfmHuman: string;
  prefillContentType?: "a-title" | "b-title" | "verse-text";
  aTitleId?: string;
  bTitleId?: string;
  verseTextId?: string;
  enRef: { aTitle?: string; bTitle?: string; verseText?: string };
  onClose: () => void;
  onSaved: () => void;
};

async function upsertRow(
  id: string | undefined,
  params: {
    campaign: string;
    language: string;
    usfmReference: string;
    contentType: string;
    text: string;
  }
): Promise<void> {
  const isTitle = params.contentType !== "verse-text";
  const payload = isTitle
    ? { title: params.text }
    : { body: params.text };

  if (id) {
    await fetch(`/api/campaign-content/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } else {
    await fetch("/api/campaign-content", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        campaign: params.campaign,
        language: params.language,
        usfmReference: params.usfmReference,
        contentType: params.contentType,
        ...payload,
      }),
    });
  }
}

export function EditContentModal({
  campaign,
  language,
  usfmReference,
  usfmHuman,
  aTitleId,
  bTitleId,
  verseTextId,
  enRef,
  onClose,
  onSaved,
}: Props) {
  const [aTitle, setATitle] = useState("");
  const [bTitle, setBTitle] = useState("");
  const [verseText, setVerseText] = useState("");
  const [saving, setSaving] = useState(false);

  const hasChanges = aTitle.trim() || bTitle.trim() || verseText.trim();

  async function handleSave() {
    setSaving(true);
    const tasks: Promise<void>[] = [];

    if (aTitle.trim()) {
      tasks.push(
        upsertRow(aTitleId, { campaign, language, usfmReference, contentType: "a-title", text: aTitle.trim() })
      );
    }
    if (bTitle.trim()) {
      tasks.push(
        upsertRow(bTitleId, { campaign, language, usfmReference, contentType: "b-title", text: bTitle.trim() })
      );
    }
    if (verseText.trim()) {
      tasks.push(
        upsertRow(verseTextId, { campaign, language, usfmReference, contentType: "verse-text", text: verseText.trim() })
      );
    }

    await Promise.all(tasks);
    setSaving(false);
    onSaved();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit — {usfmHuman}</DialogTitle>
        </DialogHeader>
        <div className="space-y-5">
          <div className="space-y-1.5">
            <Label>A-Title <span className="text-xs text-muted-foreground font-normal">(clickbait)</span></Label>
            <Textarea
              value={aTitle}
              onChange={(e) => setATitle(e.target.value)}
              placeholder="e.g. 🌱 God is about to do something new…"
              rows={2}
            />
            {enRef.aTitle && (
              <p className="text-xs text-muted-foreground">EN: {enRef.aTitle}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>B-Title <span className="text-xs text-muted-foreground font-normal">(verse reference)</span></Label>
            <Textarea
              value={bTitle}
              onChange={(e) => setBTitle(e.target.value)}
              placeholder="e.g. Reflect on Isaiah 43:18-19 today."
              rows={2}
            />
            {enRef.bTitle && (
              <p className="text-xs text-muted-foreground">EN: {enRef.bTitle}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Verse Text</Label>
            <Textarea
              value={verseText}
              onChange={(e) => setVerseText(e.target.value)}
              placeholder="Enter the verse text…"
              rows={4}
            />
            {enRef.verseText && (
              <p className="text-xs text-muted-foreground">EN: {enRef.verseText}</p>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving || !hasChanges}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
