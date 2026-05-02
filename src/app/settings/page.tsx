"use client";

import { useState } from "react";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Sparkles } from "lucide-react";

export default function SettingsPage() {
  const [saved, setSaved] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [discoveryResult, setDiscoveryResult] = useState<null | { ok: boolean; message?: string; k?: number; personasCreated?: number; personasUpdated?: number; usersAssigned?: number; silhouetteScore?: number }>(null);
  const [minInteractions, setMinInteractions] = useState(20);
  const [confidenceThreshold, setConfidenceThreshold] = useState(75);

  // Global defaults
  const [defaultFreqCap, setDefaultFreqCap] = useState(3);
  const [defaultPeriod, setDefaultPeriod] = useState("week");
  const [defaultQuietStart, setDefaultQuietStart] = useState("22:00");
  const [defaultQuietEnd, setDefaultQuietEnd] = useState("08:00");

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

  const handleSave = async () => {
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
  };

  return (
    <>
      <Header title="Settings" description="Platform configuration" />
      <div className="p-6 max-w-2xl space-y-6">
        {/* Global Defaults */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold">Global Guardrail Defaults</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="flex-1">
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
                <SelectTrigger className="w-32">
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
            <div className="flex gap-4">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Default quiet start</label>
                <Input
                  type="time"
                  value={defaultQuietStart}
                  onChange={(e) => setDefaultQuietStart(e.target.value)}
                  className="mt-1 w-32"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Default quiet end</label>
                <Input
                  type="time"
                  value={defaultQuietEnd}
                  onChange={(e) => setDefaultQuietEnd(e.target.value)}
                  className="mt-1 w-32"
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
              Automatically discovers user behavioral clusters from accumulated engagement data using k-means clustering.
              Requires users to have enough interactions before they qualify for clustering.
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
                Users below this cosine similarity threshold won&apos;t be assigned to a persona.
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
              <div className={`rounded-lg border p-3 text-xs space-y-1 ${discoveryResult.ok ? "bg-green-50 border-green-200" : "bg-muted"}`}>
                {discoveryResult.ok ? (
                  <>
                    <p className="font-semibold text-green-700">Discovery complete</p>
                    <p>Clusters found: {discoveryResult.k}</p>
                    <p>Personas created: {discoveryResult.personasCreated} · updated: {discoveryResult.personasUpdated}</p>
                    <p>Users assigned: {discoveryResult.usersAssigned}</p>
                    <p>Silhouette score: {discoveryResult.silhouetteScore?.toFixed(4)}</p>
                  </>
                ) : (
                  <p className="text-muted-foreground">{discoveryResult.message ?? "Not enough data yet."}</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex items-center gap-3">
          <Button onClick={handleSave}>Save Settings</Button>
          {saved && (
            <div className="flex items-center gap-1.5 text-green-600 text-sm">
              <CheckCircle2 className="h-4 w-4" />
              Saved!
            </div>
          )}
        </div>
      </div>
    </>
  );
}
