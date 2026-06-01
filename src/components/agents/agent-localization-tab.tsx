"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Check } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatLanguageCoverage } from "@/lib/push-coverage";

type Props = {
  agentId: string;
  initialLanguageFilter: string;
  initialLocalizePush: boolean;
  coverageLanguages: string[];
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

export function AgentLocalizationTab({
  agentId,
  initialLanguageFilter,
  initialLocalizePush,
  coverageLanguages,
}: Props) {
  const router = useRouter();
  const [englishOnly, setEnglishOnly] = useState(initialLanguageFilter === "en");
  const [localizePush, setLocalizePush] = useState(initialLocalizePush);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (savedTimerRef.current !== null) clearTimeout(savedTimerRef.current);
    };
  }, []);

  async function save(patch: Record<string, unknown>) {
    setSaving(true);
    if (savedTimerRef.current !== null) {
      clearTimeout(savedTimerRef.current);
      setSavedAt(null);
    }
    try {
      await fetch(`/api/agents/${agentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      setSavedAt(Date.now());
      savedTimerRef.current = setTimeout(() => setSavedAt(null), 2000);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  function handleEnglishOnly(next: boolean) {
    setEnglishOnly(next);
    save({ languageFilter: next ? "en" : "all" });
  }

  function handleLocalizePush(next: boolean) {
    setLocalizePush(next);
    save({ localizePush: next });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-semibold">Language Settings</CardTitle>
          <SaveStatus saving={saving} savedAt={savedAt} />
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border bg-muted/20 px-3 py-3">
            <div className="pr-4">
              <p className="text-sm font-medium">English-only audience</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Restrict sends to users whose language starts with &quot;en&quot;. When off, the agent sends to all
                languages.
              </p>
            </div>
            <Switch checked={englishOnly} onCheckedChange={handleEnglishOnly} disabled={saving} />
          </div>

          <div className="flex items-center justify-between rounded-lg border bg-muted/20 px-3 py-3">
            <div className="pr-4">
              <p className="text-sm font-medium">Localize push copy</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Send each recipient the translated copy for their language when a translation exists, falling back to
                English otherwise. When off, everyone receives the English copy.
              </p>
            </div>
            <Switch checked={localizePush} onCheckedChange={handleLocalizePush} disabled={saving || englishOnly} />
          </div>

          {englishOnly && localizePush && (
            <p className="text-xs text-muted-foreground">
              Localized copy has no effect while the audience is restricted to English.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Translation Coverage</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Languages covered</span>
            <Badge variant="outline" className="text-xs">{formatLanguageCoverage(coverageLanguages)}</Badge>
          </div>
          {coverageLanguages.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {coverageLanguages.map((lang) => (
                <Badge key={lang} variant="secondary" className="text-xs font-mono">{lang}</Badge>
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Coverage reflects active translations across this agent&apos;s push variants. Manage translations from the
            message library.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
