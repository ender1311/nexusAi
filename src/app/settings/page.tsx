"use client";

import { useState, useEffect } from "react";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { DisplayPreferences } from "@/components/settings/display-preferences";
import { CheckCircle2, Loader2, Sparkles, BarChart2 } from "lucide-react";
import {
  type PushTargetingMode,
  DEFAULT_PUSH_TARGETING_MODE,
  isPushTargetingMode,
} from "@/lib/engine/channel-preference";

const PUSH_TARGETING_MODE_OPTIONS: { value: PushTargetingMode; label: string; description: string }[] = [
  {
    value: "strict",
    label: "Strict",
    description:
      "Push agents only target users whose behavioral preferred external channel is push (30-day for active stages, 90-day for lapsed). Smallest, highest-intent audience.",
  },
  {
    value: "permissive",
    label: "Permissive",
    description:
      "Cascade through external 30d → 90d → overall windows, then engagement stats. Users with no preference signal are included. Larger audience.",
  },
  {
    value: "broad",
    label: "Broad",
    description:
      "Preferred-channel gate disabled. Push agents target everyone eligible by persona, opt-out and language. Largest audience.",
  },
];

export default function SettingsPage() {
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [discoveryResult, setDiscoveryResult] = useState<null | { ok: boolean; message?: string; k?: number; personasCreated?: number; personasUpdated?: number; usersAssigned?: number; silhouetteScore?: number }>(null);
  const [minInteractions, setMinInteractions] = useState(20);
  const [confidenceThreshold, setConfidenceThreshold] = useState(75);

  // Global defaults
  const [defaultFreqCap, setDefaultFreqCap] = useState(3);
  const [defaultPeriod, setDefaultPeriod] = useState("week");
  const [defaultQuietStart, setDefaultQuietStart] = useState("22:00");
  const [defaultQuietEnd, setDefaultQuietEnd] = useState("08:00");

  // AI Lift Measurement settings
  const [baselineRate, setBaselineRate] = useState("1.2");
  const [baselineConvRate, setBaselineConvRate] = useState("");
  const [liftSinceDate, setLiftSinceDate] = useState("");
  const [liftSaved, setLiftSaved] = useState(false);
  const [liftSaving, setLiftSaving] = useState(false);

  // Agent defaults
  const [givingMultiplier, setGivingMultiplier] = useState("24");
  const [agentDefaultsSaved, setAgentDefaultsSaved] = useState(false);
  const [agentDefaultsSaving, setAgentDefaultsSaving] = useState(false);

  const [pushTargetingMode, setPushTargetingMode] = useState<PushTargetingMode>(DEFAULT_PUSH_TARGETING_MODE);
  const [pushTargetingSaved, setPushTargetingSaved] = useState(false);
  const [pushTargetingSaving, setPushTargetingSaving] = useState(false);

  const handleDiscover = async () => {
    setDiscovering(true);
    setDiscoveryResult(null);
    try {
      const res = await fetch("/api/personas/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ minInteractions, confidenceThreshold: confidenceThreshold / 100 }),
      });
      const data = await res.json();
      setDiscoveryResult(data);
    } catch {
      setDiscoveryResult({ ok: false, message: "Request failed" });
    } finally {
      setDiscovering(false);
    }
  };

  // Load existing lift settings on mount
  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data: Record<string, string>) => {
        if (data["baseline_push_open_rate"]) setBaselineRate(data["baseline_push_open_rate"]);
        if (data["baseline_conversion_rate"]) setBaselineConvRate(data["baseline_conversion_rate"]);
        if (data["lift_since_date"]) setLiftSinceDate(data["lift_since_date"]);
        if (data["giving_dollars_to_bibles_multiplier"]) setGivingMultiplier(data["giving_dollars_to_bibles_multiplier"]);
        if (isPushTargetingMode(data["push_targeting_mode"])) setPushTargetingMode(data["push_targeting_mode"]);
      })
      .catch(() => {});
  }, []);

  const handleSaveLift = async () => {
    setLiftSaving(true);
    try {
      await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseline_push_open_rate: baselineRate,
          baseline_conversion_rate: baselineConvRate,
          lift_since_date: liftSinceDate,
        }),
      });
      setLiftSaved(true);
      setTimeout(() => setLiftSaved(false), 3000);
    } finally {
      setLiftSaving(false);
    }
  };

  const handleSaveAgentDefaults = async () => {
    setAgentDefaultsSaving(true);
    try {
      await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ giving_dollars_to_bibles_multiplier: givingMultiplier }),
      });
      setAgentDefaultsSaved(true);
      setTimeout(() => setAgentDefaultsSaved(false), 3000);
    } finally {
      setAgentDefaultsSaving(false);
    }
  };

  const handleSavePushTargeting = async () => {
    setPushTargetingSaving(true);
    try {
      await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ push_targeting_mode: pushTargetingMode }),
      });
      setPushTargetingSaved(true);
      setTimeout(() => setPushTargetingSaved(false), 3000);
    } finally {
      setPushTargetingSaving(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          default_frequency_cap: String(defaultFreqCap),
          default_frequency_period: defaultPeriod,
          default_quiet_start: defaultQuietStart,
          default_quiet_end: defaultQuietEnd,
        }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Header title="Settings" description="Platform configuration" />
      <div className="p-4 sm:p-6 max-w-3xl space-y-4 sm:space-y-6">
        {/* Global Defaults */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold">Default Send Limits</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-end gap-4">
              <div className="flex-1 min-w-[12rem]">
                <label className="text-xs font-medium text-muted-foreground">
                  Default frequency cap: {defaultFreqCap} sends
                </label>
                <Slider
                  min={1} max={14} step={1}
                  value={[defaultFreqCap]}
                  onValueChange={(v) => setDefaultFreqCap(Array.isArray(v) ? v[0] : v)}
                  className="mt-2"
                />
              </div>
              <Select value={defaultPeriod} onValueChange={(v) => v && setDefaultPeriod(v)}>
                <SelectTrigger className="w-full sm:w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="day">per Day</SelectItem>
                  <SelectItem value="week">per Week</SelectItem>
                  <SelectItem value="biweek">per 2 Weeks</SelectItem>
                  <SelectItem value="month">per Month</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-wrap gap-4">
              <div className="flex-1 min-w-[8rem]">
                <label className="text-xs font-medium text-muted-foreground">Default quiet start</label>
                <Input
                  type="time"
                  value={defaultQuietStart}
                  onChange={(e) => setDefaultQuietStart(e.target.value)}
                  className="mt-1 w-full sm:w-32"
                />
              </div>
              <div className="flex-1 min-w-[8rem]">
                <label className="text-xs font-medium text-muted-foreground">Default quiet end</label>
                <Input
                  type="time"
                  value={defaultQuietEnd}
                  onChange={(e) => setDefaultQuietEnd(e.target.value)}
                  className="mt-1 w-full sm:w-32"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Persona Discovery */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
                <Sparkles className="h-4 w-4" />
                Persona Discovery
              </CardTitle>
              <Badge variant="outline" className="text-xs">Self-Learning</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Automatically groups users into behavioral segments based on their activity patterns.
              Users need a minimum number of interactions before they can be assigned to a segment.
            </p>
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                Min interactions to qualify: {minInteractions}
              </label>
              <Slider
                min={5} max={100} step={5}
                value={[minInteractions]}
                onValueChange={(v) => setMinInteractions(Array.isArray(v) ? v[0] : v)}
                className="mt-2"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                Confidence threshold: {confidenceThreshold}%
              </label>
              <Slider
                min={50} max={95} step={5}
                value={[confidenceThreshold]}
                onValueChange={(v) => setConfidenceThreshold(Array.isArray(v) ? v[0] : v)}
                className="mt-2"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Users who don&apos;t match any segment closely enough won&apos;t be assigned to one.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDiscover}
              disabled={discovering}
              className="gap-1.5"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {discovering ? "Running Discovery…" : "Run Discovery"}
            </Button>
            {discoveryResult && (
              <div className={`rounded-lg border p-3 text-xs space-y-1 ${
                discoveryResult.ok
                  ? "bg-emerald-50 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-800"
                  : "bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800"
              }`}>
                {discoveryResult.ok ? (
                  <>
                    <p className="font-semibold text-green-700 dark:text-green-400">Discovery complete</p>
                    <p>Clusters found: {discoveryResult.k}</p>
                    <p>Personas created: {discoveryResult.personasCreated} · updated: {discoveryResult.personasUpdated}</p>
                    <p>Users assigned: {discoveryResult.usersAssigned}</p>
                    <p>Cluster quality: {discoveryResult.silhouetteScore !== undefined ? `${(discoveryResult.silhouetteScore * 100).toFixed(1)}%` : "—"} (higher = more distinct segments)</p>
                  </>
                ) : (
                  <p className="text-red-700 dark:text-red-400">{discoveryResult.message ?? "Not enough data to run discovery yet. Accumulate more user interactions first."}</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* AI Lift Measurement */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
                <BarChart2 className="h-4 w-4" />
                AI Lift Measurement
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Configure the non-Nexus baselines used to measure AI-driven lift on the Performance page.
              Each baseline is compared like-for-like against the matching Nexus rate.
            </p>
            <div className="flex flex-wrap gap-4">
              <div className="flex-1 min-w-[8rem]">
                <label className="text-xs font-medium text-muted-foreground">Baseline push open rate (%)</label>
                <Input
                  type="number"
                  step="0.1"
                  min="0"
                  max="100"
                  placeholder="1.2"
                  value={baselineRate}
                  onChange={(e) => setBaselineRate(e.target.value)}
                  className="mt-1 w-full sm:w-32"
                />
              </div>
              <div className="flex-1 min-w-[8rem]">
                <label className="text-xs font-medium text-muted-foreground">Baseline conversion rate (%)</label>
                <Input
                  type="number"
                  step="0.1"
                  min="0"
                  max="100"
                  placeholder="0"
                  value={baselineConvRate}
                  onChange={(e) => setBaselineConvRate(e.target.value)}
                  className="mt-1 w-full sm:w-32"
                />
                <p className="text-xs text-muted-foreground mt-1">Leave blank until you have a real number.</p>
              </div>
              <div className="flex-1 min-w-[8rem]">
                <label className="text-xs font-medium text-muted-foreground">Measure Nexus lift from</label>
                <Input
                  type="date"
                  value={liftSinceDate}
                  onChange={(e) => setLiftSinceDate(e.target.value)}
                  className="mt-1 w-full sm:w-40"
                />
                <p className="text-xs text-muted-foreground mt-1">Leave blank to include all-time sends.</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Button onClick={handleSaveLift} disabled={liftSaving} size="sm">
                {liftSaving ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Saving…
                  </>
                ) : "Save Lift Settings"}
              </Button>
              {liftSaved && (
                <div className="flex items-center gap-1.5 text-green-600 dark:text-green-400 text-sm">
                  <CheckCircle2 className="h-4 w-4" />
                  Saved!
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Agent Defaults */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold">Agent Defaults</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Dynamic giving handles render &ldquo;A gift of $X a month will distribute over Y Bible apps this year&rdquo;,
              where Y = the USD ask × this multiplier. Applies to all dynamic-handle pushes.
            </p>
            <div className="flex flex-wrap items-end gap-4">
              <div className="flex-1 min-w-[12rem]">
                <label className="text-xs font-medium text-muted-foreground">Dollars to Bibles multiplier</label>
                <Input
                  type="number"
                  step="1"
                  min="1"
                  placeholder="24"
                  value={givingMultiplier}
                  onChange={(e) => setGivingMultiplier(e.target.value)}
                  className="mt-1 w-full sm:w-32"
                />
                <p className="text-xs text-muted-foreground mt-1">Default 24 ($25/mo → 600 Bibles).</p>
              </div>
              <Button onClick={handleSaveAgentDefaults} disabled={agentDefaultsSaving} size="sm">
                {agentDefaultsSaving ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Saving…
                  </>
                ) : "Save Agent Defaults"}
              </Button>
              {agentDefaultsSaved && (
                <div className="flex items-center gap-1.5 text-green-600 dark:text-green-400 text-sm">
                  <CheckCircle2 className="h-4 w-4" />
                  Saved!
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Push Targeting Mode */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold">Push Targeting Mode</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Controls how strictly push agents respect each user&apos;s behavioral preferred channel
              (synced from Hightouch). Applies to every push agent on both the lottery and exploration-window
              send paths.
            </p>
            <div className="flex flex-wrap items-end gap-4">
              <div className="flex-1 min-w-[12rem]">
                <label className="text-xs font-medium text-muted-foreground">Targeting strictness</label>
                <Select value={pushTargetingMode} onValueChange={(v) => setPushTargetingMode(v as PushTargetingMode)}>
                  <SelectTrigger className="mt-1 w-full sm:w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PUSH_TARGETING_MODE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  {PUSH_TARGETING_MODE_OPTIONS.find((o) => o.value === pushTargetingMode)?.description}
                </p>
              </div>
              <Button onClick={handleSavePushTargeting} disabled={pushTargetingSaving} size="sm">
                {pushTargetingSaving ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Saving…
                  </>
                ) : "Save Push Targeting"}
              </Button>
              {pushTargetingSaved && (
                <div className="flex items-center gap-1.5 text-green-600 dark:text-green-400 text-sm">
                  <CheckCircle2 className="h-4 w-4" />
                  Saved!
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Display Preferences (per-user) */}
        <DisplayPreferences />

        <div className="flex items-center gap-3">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving…
              </>
            ) : "Save Settings"}
          </Button>
          {saved && (
            <div className="flex items-center gap-1.5 text-green-600 dark:text-green-400 text-sm">
              <CheckCircle2 className="h-4 w-4" />
              Saved!
            </div>
          )}
        </div>
      </div>
    </>
  );
}
