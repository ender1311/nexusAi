"use client";

import { useState, use, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { FrequencyCap, QuietHours } from "@/types/agent";
import { Loader2, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

type AgentData = {
  name: string;
  schedulingRule: {
    frequencyCap: FrequencyCap;
    quietHours: QuietHours;
    blackoutDates: string[];
    smartSuppress: boolean;
    suppressThresh: number;
  } | null;
};

const PERIOD_LABELS: Record<string, string> = {
  day: "per day",
  week: "per week",
  biweek: "per 2 weeks",
  month: "per month",
};

export default function SchedulingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const [agentName, setAgentName] = useState<string>("");
  const [loading, setLoading] = useState(true);

  const [freqCap, setFreqCap] = useState<FrequencyCap>({ maxSends: 3, period: "week" });
  const [quietHours, setQuietHours] = useState<QuietHours>({
    start: "22:00",
    end: "08:00",
    timezone: "America/New_York",
  });
  const [blackoutDates, setBlackoutDates] = useState<string[]>([]);
  const [newBlackout, setNewBlackout] = useState("");
  const [smartSuppress, setSmartSuppress] = useState(false);
  const [suppressThresh, setSuppressThresh] = useState(0.5);

  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/agents/${id}`);
        if (!res.ok) throw new Error("not found");
        const data = (await res.json()) as AgentData;
        setAgentName(data.name);
        if (data.schedulingRule) {
          setFreqCap(data.schedulingRule.frequencyCap);
          setQuietHours(data.schedulingRule.quietHours);
          setBlackoutDates(data.schedulingRule.blackoutDates ?? []);
          setSmartSuppress(data.schedulingRule.smartSuppress);
          setSuppressThresh(data.schedulingRule.suppressThresh);
        }
      } catch {
        // leave defaults
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [id]);

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
      const res = await fetch(`/api/agents/${id}/scheduling`, {
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

  if (loading) {
    return (
      <>
        <Header title="Scheduling & Guardrails" />
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      </>
    );
  }

  return (
    <>
      <Header title="Scheduling & Guardrails" description={agentName} />
      <div className="p-6 max-w-2xl space-y-6">

        {/* Frequency Cap */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold">Frequency Cap</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Limit how many messages a user can receive in a given period.
            </p>
            <div className="flex items-center gap-4">
              <div className="flex-1">
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
                <SelectTrigger className="w-36">
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
              No messages are sent during these hours. Times apply in each user&apos;s local timezone via Braze&apos;s in-local-time delivery.
            </p>
            <div className="flex items-center gap-3 flex-wrap">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">From</label>
                <Input
                  type="time"
                  value={quietHours.start}
                  onChange={(e) => setQuietHours((q) => ({ ...q, start: e.target.value }))}
                  className="w-32"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">To</label>
                <Input
                  type="time"
                  value={quietHours.end}
                  onChange={(e) => setQuietHours((q) => ({ ...q, end: e.target.value }))}
                  className="w-32"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Reference timezone</label>
                <Select
                  value={quietHours.timezone}
                  onValueChange={(v) => v && setQuietHours((q) => ({ ...q, timezone: v }))}
                >
                  <SelectTrigger className="w-44">
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
                className="w-44"
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
    </>
  );
}
