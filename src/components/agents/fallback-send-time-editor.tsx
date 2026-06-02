"use client";

import { useState, useEffect, useRef } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Loader2, Check } from "lucide-react";

type Props = {
  agentId: string;
  fallbackSendHour: number | null;
};

function formatHour(hour: number): string {
  if (hour === 0) return "12:00 AM";
  if (hour < 12) return `${hour}:00 AM`;
  if (hour === 12) return "12:00 PM";
  return `${hour - 12}:00 PM`;
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);

export function FallbackSendTimeEditor({ agentId, fallbackSendHour }: Props) {
  const effectiveHour = fallbackSendHour ?? 8;
  const [selectedHour, setSelectedHour] = useState<number>(effectiveHour);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear "Saved" indicator after 2 seconds
  useEffect(() => {
    return () => {
      if (savedTimerRef.current !== null) {
        clearTimeout(savedTimerRef.current);
      }
    };
  }, []);

  async function handleChange(value: string | null) {
    if (value === null) return;
    const hour = parseInt(value, 10);
    setSelectedHour(hour);

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
        body: JSON.stringify({ fallbackSendHour: hour }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error ?? "Failed to save. Please try again.");
        return;
      }
      setSavedAt(Date.now());
      savedTimerRef.current = setTimeout(() => {
        setSavedAt(null);
      }, 2000);
    } catch {
      setError("Network error — please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Select value={String(selectedHour)} onValueChange={handleChange}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {HOURS.map((hour) => (
              <SelectItem key={hour} value={String(hour)}>
                {formatHour(hour)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

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
        Braze delivers at this hour in each user&apos;s local timezone. Users with app usage history receive pushes timed to their session window instead.
      </p>
    </div>
  );
}
