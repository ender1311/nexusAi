"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Check } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Props = {
  agentId: string;
  initialLocalizePush: boolean;
};

function SaveStatus({ saving, savedAt }: { saving: boolean; savedAt: number | null }) {
  return (
    <div className={cn("flex items-center gap-1 text-xs", saving ? "text-muted-foreground" : "text-green-600")}>
      {saving && <Loader2 className="h-3 w-3 animate-spin" />}
      {saving && <span>Saving…</span>}
      {!saving && savedAt !== null && (
        <>
          <Check className="h-3 w-3" />
          <span>Saved</span>
        </>
      )}
    </div>
  );
}

export function AgentLocalizationTab({ agentId, initialLocalizePush }: Props) {
  const router = useRouter();
  const [localizePush, setLocalizePush] = useState(initialLocalizePush);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (savedTimerRef.current !== null) clearTimeout(savedTimerRef.current);
    };
  }, []);

  async function handleLocalizePush(next: boolean) {
    setLocalizePush(next);
    setSaving(true);
    setError(null);
    if (savedTimerRef.current !== null) {
      clearTimeout(savedTimerRef.current);
      setSavedAt(null);
    }
    try {
      const res = await fetch(`/api/agents/${agentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ localizePush: next }),
      });
      if (!res.ok) {
        // Revert the optimistic toggle so the UI reflects the persisted state.
        setLocalizePush(!next);
        const body = await res.json().catch(() => null);
        setError(body?.error ?? "Failed to save. Please try again.");
        return;
      }
      setSavedAt(Date.now());
      savedTimerRef.current = setTimeout(() => setSavedAt(null), 2000);
      router.refresh();
    } catch {
      setLocalizePush(!next);
      setError("Network error — please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-semibold">Language Settings</CardTitle>
        <SaveStatus saving={saving} savedAt={savedAt} />
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between rounded-lg border bg-muted/20 px-3 py-3">
          <div className="pr-4">
            <p className="text-sm font-medium">Localize push copy</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Send each recipient the translated copy for their language. Recipients whose language has no
              translation are skipped (no English fallback); English-speaking recipients still receive the English
              copy. When off, everyone receives the English copy.
            </p>
          </div>
          <Switch checked={localizePush} onCheckedChange={handleLocalizePush} disabled={saving} />
        </div>
        {error && <p className="text-xs text-destructive mt-2" role="alert">{error}</p>}
      </CardContent>
    </Card>
  );
}
