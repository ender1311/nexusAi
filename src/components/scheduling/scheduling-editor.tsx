"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { FrequencyCap, QuietHours, QuietHoursMode, SchedulingRule } from "@/types/agent";
import { Loader2, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

const PERIOD_LABELS: Record<string, string> = {
  day: "per day",
  week: "per week",
  biweek: "per 2 weeks",
  month: "per month",
};

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => {
  const suffix = h < 12 ? "AM" : "PM";
  const display = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return { value: h, label: `${display}:00 ${suffix}` };
});

function resolveInitialQuietHours(initial: SchedulingRule | null): QuietHours {
  const qh = initial?.quietHours;
  if (!qh) return { mode: "none" };
  if (qh.mode) return qh;
  // Backward compat: old records lack a mode field
  const legacy = qh as { start?: string; end?: string; timezone?: string };
  if (legacy.timezone === "user") return { mode: "schedule", deliverAtHour: 8 };
  return {
    mode: "suppress",
    start: legacy.start ?? "22:00",
    end: legacy.end ?? "08:00",
    timezone: legacy.timezone ?? "America/New_York",
  };
}

type Props = {
  agentId: string;
  initialRule: SchedulingRule | null;
};

type ModeOption = {
  value: QuietHoursMode;
  label: string;
  description: string;
};

const MODE_OPTIONS: ModeOption[] = [
  {
    value: "none",
    label: "Off",
    description: "No quiet hours. Nexus picks the best hour per user from behavioral data; users without data fall back to Braze in-local-time delivery.",
  },
  {
    value: "suppress",
    label: "Suppress",
    description: "Skip if in quiet window. Server-side check at send time using each user's stored timezone (Hightouch). Users in the quiet window are skipped entirely for that cron run.",
  },
  {
    value: "schedule",
    label: "Schedule",
    description: "Deliver at a fixed local hour via Braze. All messages are queued and Braze delivers them at the chosen hour in each user's own timezone. No messages are suppressed.",
  },
];

export function SchedulingEditor({ agentId, initialRule }: Props) {
  const router = useRouter();

  const [freqCap, setFreqCap] = useState<FrequencyCap>(
    initialRule?.frequencyCap ?? { maxSends: 3, period: "week" },
  );
  const [quietHours, setQuietHours] = useState<QuietHours>(
    resolveInitialQuietHours(initialRule),
  );
  const [blackoutDates, setBlackoutDates] = useState<string[]>(
    initialRule?.blackoutDates ?? [],
  );
  const [newBlackout, setNewBlackout] = useState("");
  const [smartSuppress, setSmartSuppress] = useState(initialRule?.smartSuppress ?? false);
  const [suppressThresh, setSuppressThresh] = useState(initialRule?.suppressThresh ?? 0.5);

  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function selectMode(mode: QuietHoursMode) {
    if (mode === "none") {
      setQuietHours({ mode: "none" });
    } else if (mode === "suppress") {
      setQuietHours((q) => ({
        mode: "suppress",
        start: q.start ?? "22:00",
        end: q.end ?? "08:00",
        timezone: q.timezone ?? "America/New_York",
      }));
    } else {
      setQuietHours((q) => ({
        mode: "schedule",
        deliverAtHour: q.deliverAtHour ?? 8,
      }));
    }
  }

  function addBlackout() {
    if (newBlackout && !blackoutDates.includes(newBlackout)) {
      setBlackoutDates((d) => [...d, newBlackout].sort());
    }
    setNewBlackout("");
  }

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    if (savedTimerRef.current !== null) {
      clearTimeout(savedTimerRef.current);
      setSavedAt(null);
    }
    try {
      const res = await fetch(`/api/agents/${agentId}/scheduling`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ frequencyCap: freqCap, quietHours, blackoutDates, smartSuppress, suppressThresh }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Save failed");
      }
      setSavedAt(Date.now());
      savedTimerRef.current = setTimeout(() => setSavedAt(null), 3000);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-4 sm:p-6 max-w-2xl space-y-4 sm:space-y-6">

      {/* Frequency Cap */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Frequency Cap</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Limit how many messages a user can receive in a given period.
          </p>
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex-1 min-w-[12rem]">
              <label className="text-xs text-muted-foreground">Max sends: {freqCap.maxSends}</label>
              <Slider
                min={1} max={14} step={1}
                value={[freqCap.maxSends]}
                onValueChange={(v) => setFreqCap((f) => ({ ...f, maxSends: Array.isArray(v) ? v[0] : v }))}
                className="mt-1"
              />
            </div>
            <Select
              value={freqCap.period}
              onValueChange={(v) => v && setFreqCap((f) => ({ ...f, period: v as FrequencyCap["period"] }))}
            >
              <SelectTrigger className="w-full sm:w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="day">per day</SelectItem>
                <SelectItem value="week">per week</SelectItem>
                <SelectItem value="biweek">per 2 weeks</SelectItem>
                <SelectItem value="month">per month</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground bg-muted rounded-md p-2">
            Users receive at most <strong>{freqCap.maxSends} message{freqCap.maxSends !== 1 ? "s" : ""}</strong>{" "}
            <strong>{PERIOD_LABELS[freqCap.period] ?? freqCap.period}</strong> from this agent.
          </p>
        </CardContent>
      </Card>

      {/* Quiet Hours */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Quiet Hours</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Control when messages are allowed to reach users.
          </p>

          {/* Mode selector */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {MODE_OPTIONS.map((opt) => {
              const selected = quietHours.mode === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => selectMode(opt.value)}
                  className={cn(
                    "text-left rounded-lg border p-3 transition-colors",
                    selected
                      ? "border-primary bg-primary/5 ring-1 ring-primary"
                      : "border-border hover:border-primary/50 hover:bg-muted/50",
                  )}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <div className={cn(
                      "h-3.5 w-3.5 rounded-full border-2 flex-shrink-0",
                      selected ? "border-primary bg-primary" : "border-muted-foreground",
                    )} />
                    <span className="text-xs font-semibold">{opt.label}</span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-snug">{opt.description}</p>
                </button>
              );
            })}
          </div>

          {/* Suppress: window + fallback timezone */}
          {quietHours.mode === "suppress" && (
            <div className="flex flex-wrap gap-3 pt-1">
              <div className="flex-1 min-w-[7rem]">
                <label className="text-xs text-muted-foreground block mb-1">From</label>
                <Input
                  type="time"
                  value={quietHours.start ?? "22:00"}
                  onChange={(e) => setQuietHours((q) => ({ ...q, start: e.target.value }))}
                  className="w-full"
                />
              </div>
              <div className="flex-1 min-w-[7rem]">
                <label className="text-xs text-muted-foreground block mb-1">To</label>
                <Input
                  type="time"
                  value={quietHours.end ?? "08:00"}
                  onChange={(e) => setQuietHours((q) => ({ ...q, end: e.target.value }))}
                  className="w-full"
                />
              </div>
              <div className="flex-1 min-w-[11rem]">
                <label className="text-xs text-muted-foreground block mb-1">Fallback timezone</label>
                <Select
                  value={quietHours.timezone ?? "America/New_York"}
                  onValueChange={(v) => v && setQuietHours((q) => ({ ...q, timezone: v }))}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="America/New_York">Eastern (ET)</SelectItem>
                    <SelectItem value="America/Chicago">Central (CT)</SelectItem>
                    <SelectItem value="America/Denver">Mountain (MT)</SelectItem>
                    <SelectItem value="America/Los_Angeles">Pacific (PT)</SelectItem>
                    <SelectItem value="America/Phoenix">Arizona (no DST)</SelectItem>
                    <SelectItem value="Europe/London">London (GMT/BST)</SelectItem>
                    <SelectItem value="Europe/Paris">Paris (CET)</SelectItem>
                    <SelectItem value="Europe/Helsinki">Helsinki (EET)</SelectItem>
                    <SelectItem value="Asia/Dubai">Dubai (GST)</SelectItem>
                    <SelectItem value="Asia/Kolkata">India (IST)</SelectItem>
                    <SelectItem value="Asia/Singapore">Singapore (SGT)</SelectItem>
                    <SelectItem value="Asia/Tokyo">Tokyo (JST)</SelectItem>
                    <SelectItem value="Australia/Sydney">Sydney (AEST)</SelectItem>
                    <SelectItem value="Pacific/Auckland">Auckland (NZST)</SelectItem>
                    <SelectItem value="UTC">UTC</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {/* Schedule: deliver-at hour */}
          {quietHours.mode === "schedule" && (
            <div className="pt-1 max-w-[12rem]">
              <label className="text-xs text-muted-foreground block mb-1">Deliver at (local time)</label>
              <Select
                value={String(quietHours.deliverAtHour ?? 8)}
                onValueChange={(v) => v && setQuietHours((q) => ({ ...q, deliverAtHour: parseInt(v, 10) }))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HOUR_OPTIONS.map((h) => (
                    <SelectItem key={h.value} value={String(h.value)}>{h.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Blackout Dates */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Blackout Dates</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            No messages will be sent on these dates regardless of user activity.
          </p>
          <div className="flex gap-2">
            <Input
              type="date"
              value={newBlackout}
              onChange={(e) => setNewBlackout(e.target.value)}
              className="flex-1 min-w-[8rem]"
            />
            <Button size="sm" variant="outline" onClick={addBlackout} disabled={!newBlackout}>
              Add
            </Button>
          </div>
          {blackoutDates.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {blackoutDates.map((d) => (
                <Badge key={d} variant="outline" className="text-xs gap-1">
                  {d}
                  <button
                    onClick={() => setBlackoutDates((dates) => dates.filter((x) => x !== d))}
                    aria-label={`Remove blackout date ${d}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Smart Suppression */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm font-semibold">Low-Probability Suppression</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Skip users unlikely to convert to focus sends on higher-value moments.
              </p>
            </div>
            <Switch checked={smartSuppress} onCheckedChange={setSmartSuppress} />
          </div>
        </CardHeader>
        {smartSuppress && (
          <CardContent className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">
                Minimum predicted conversion: {(suppressThresh * 100).toFixed(0)}%
              </label>
              <Slider
                min={0.05} max={0.9} step={0.05}
                value={[suppressThresh]}
                onValueChange={(v) => setSuppressThresh(Array.isArray(v) ? v[0] : v)}
                className="mt-1"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Users with a predicted conversion rate below {(suppressThresh * 100).toFixed(0)}% will not receive a message this run.
              </p>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Save */}
      <div className="flex items-center gap-3">
        <Button size="sm" onClick={() => void handleSave()} disabled={saving}>
          {saving ? (
            <>
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              Saving…
            </>
          ) : (
            "Save Rules"
          )}
        </Button>
        <Button size="sm" variant="outline" onClick={() => router.back()} disabled={saving}>
          Cancel
        </Button>

        <div className={cn("flex items-center gap-1 text-xs", "text-green-600")}>
          {!saving && savedAt !== null && (
            <>
              <Check className="h-3.5 w-3.5" />
              <span>Saved</span>
            </>
          )}
        </div>

        {saveError && (
          <p className="text-xs text-red-500">{saveError}</p>
        )}
      </div>
    </div>
  );
}
