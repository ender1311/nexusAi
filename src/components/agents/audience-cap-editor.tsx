"use client";

import { useState, useEffect, useRef } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Loader2, Check } from "lucide-react";
import { InfoTip } from "@/components/ui/info-tip";

type Props = {
  agentId: string;
  audienceCap: number | null;
};

const PRESET_OPTIONS = [
  { label: "No cap", value: "none" },
  { label: "1 user", value: "1" },
  { label: "5 users", value: "5" },
  { label: "10 users", value: "10" },
  { label: "20 users", value: "20" },
  { label: "50 users", value: "50" },
  { label: "100 users", value: "100" },
  { label: "250 users", value: "250" },
  { label: "500 users", value: "500" },
  { label: "1,000 users", value: "1000" },
  { label: "Custom…", value: "custom" },
];

export function AudienceCapEditor({ agentId, audienceCap }: Props) {
  const initialPreset =
    audienceCap === null
      ? "none"
      : PRESET_OPTIONS.find((o) => o.value === String(audienceCap))
        ? String(audienceCap)
        : "custom";

  const [preset, setPreset] = useState<string>(initialPreset);
  const [customValue, setCustomValue] = useState<string>(
    audienceCap !== null && initialPreset === "custom" ? String(audienceCap) : ""
  );
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (savedTimerRef.current !== null) clearTimeout(savedTimerRef.current);
    };
  }, []);

  async function save(cap: number | null) {
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
        body: JSON.stringify({ audienceCap: cap }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error ?? "Failed to save. Please try again.");
        return;
      }
      setSavedAt(Date.now());
      savedTimerRef.current = setTimeout(() => setSavedAt(null), 2000);
    } catch {
      setError("Network error — please try again.");
    } finally {
      setSaving(false);
    }
  }

  function handlePresetChange(value: string | null) {
    if (!value) return;
    setPreset(value);
    if (value === "none") {
      save(null);
    } else if (value !== "custom") {
      save(parseInt(value, 10));
    }
    // "custom" — wait for user to confirm input
  }

  function handleCustomBlur() {
    const n = parseInt(customValue, 10);
    if (!isNaN(n) && n >= 1) save(n);
  }

  function handleCustomKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") handleCustomBlur();
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-xs font-medium text-muted-foreground">Max users per cron run</span>
        <InfoTip title="Audience Cap">
          <p>Limits how many users receive a message in each cron run. The cap is applied before any message is sent, so a run with cap=100 selects at most 100 users.</p>
          <p className="mt-1"><strong>Start small.</strong> Use 1–20 when first activating an agent to validate that sends look correct before rolling out to your full audience. Increase once confirmed.</p>
          <p className="mt-1">Every agent must have a cap — this prevents accidental mass-sends and gives you a predictable send rate as you scale.</p>
        </InfoTip>
      </div>
      <div className="flex items-center gap-3">
        <Select value={preset} onValueChange={handlePresetChange}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PRESET_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {preset === "custom" && (
          <Input
            type="number"
            min={1}
            className="w-28"
            placeholder="e.g. 75"
            value={customValue}
            onChange={(e) => setCustomValue(e.target.value)}
            onBlur={handleCustomBlur}
            onKeyDown={handleCustomKeyDown}
          />
        )}

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
      </div>

      {error && <p className="text-xs text-destructive" role="alert">{error}</p>}

      <p className="text-xs text-muted-foreground">
        Controls the rollout size per cron run. Increase gradually as you validate send quality.
      </p>
    </div>
  );
}
