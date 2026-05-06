"use client";

import { useState, useEffect } from "react";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Loader2, Sparkles, UserPlus, Trash2, FlaskConical } from "lucide-react";

type TestUser = { externalId: string; name: string; personaId: string | null; createdAt: string };

export default function SettingsPage() {
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [discoveryResult, setDiscoveryResult] = useState<null | { ok: boolean; message?: string; k?: number; personasCreated?: number; personasUpdated?: number; usersAssigned?: number; silhouetteScore?: number }>(null);
  const [minInteractions, setMinInteractions] = useState(20);
  const [confidenceThreshold, setConfidenceThreshold] = useState(75);

  // Test users
  const [testUsers, setTestUsers] = useState<TestUser[]>([]);
  const [newUserName, setNewUserName] = useState("");
  const [newUserExternalId, setNewUserExternalId] = useState("");
  const [addingUser, setAddingUser] = useState(false);
  const [addUserError, setAddUserError] = useState<string | null>(null);
  const [removingUserId, setRemovingUserId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/test-users")
      .then((r) => r.json())
      .then((d) => setTestUsers(d.data ?? []))
      .catch(() => {});
  }, []);

  const handleAddUser = async () => {
    if (!newUserName.trim() || !newUserExternalId.trim()) return;
    setAddingUser(true);
    setAddUserError(null);
    try {
      const res = await fetch("/api/test-users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newUserName.trim(), externalId: newUserExternalId.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAddUserError(data.error ?? "Failed to add user");
        return;
      }
      setTestUsers((prev) => {
        const existing = prev.findIndex((u) => u.externalId === data.data.externalId);
        if (existing >= 0) {
          const next = [...prev];
          next[existing] = data.data;
          return next;
        }
        return [...prev, data.data];
      });
      setNewUserName("");
      setNewUserExternalId("");
    } finally {
      setAddingUser(false);
    }
  };

  const handleRemoveUser = async (externalId: string) => {
    setRemovingUserId(externalId);
    try {
      await fetch(`/api/test-users?externalId=${encodeURIComponent(externalId)}`, { method: "DELETE" });
      setTestUsers((prev) => prev.filter((u) => u.externalId !== externalId));
    } finally {
      setRemovingUserId(null);
    }
  };

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
                  ? "bg-emerald-50 border-emerald-200"
                  : "bg-red-50 border-red-200"
              }`}>
                {discoveryResult.ok ? (
                  <>
                    <p className="font-semibold text-green-700">Discovery complete</p>
                    <p>Clusters found: {discoveryResult.k}</p>
                    <p>Personas created: {discoveryResult.personasCreated} · updated: {discoveryResult.personasUpdated}</p>
                    <p>Users assigned: {discoveryResult.usersAssigned}</p>
                    <p>Cluster quality: {discoveryResult.silhouetteScore !== undefined ? `${(discoveryResult.silhouetteScore * 100).toFixed(1)}%` : "—"} (higher = more distinct segments)</p>
                  </>
                ) : (
                  <p className="text-red-700">{discoveryResult.message ?? "Not enough data to run discovery yet. Accumulate more user interactions first."}</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Test Users */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
                <FlaskConical className="h-4 w-4" />
                Test Users
              </CardTitle>
              <Badge variant="outline" className="text-xs">Dev</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Named Braze users for end-to-end send testing. These are real external IDs that receive live pushes.
            </p>

            {/* Add form */}
            <div className="flex gap-2">
              <Input
                placeholder="Name"
                value={newUserName}
                onChange={(e) => setNewUserName(e.target.value)}
                className="w-40 text-sm"
                onKeyDown={(e) => e.key === "Enter" && handleAddUser()}
              />
              <Input
                placeholder="Braze external ID"
                value={newUserExternalId}
                onChange={(e) => setNewUserExternalId(e.target.value)}
                className="flex-1 text-sm font-mono"
                onKeyDown={(e) => e.key === "Enter" && handleAddUser()}
              />
              <Button
                size="sm"
                onClick={handleAddUser}
                disabled={addingUser || !newUserName.trim() || !newUserExternalId.trim()}
                className="gap-1.5 shrink-0"
              >
                {addingUser ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
                Add
              </Button>
            </div>
            {addUserError && <p className="text-xs text-red-600">{addUserError}</p>}

            {/* List */}
            {testUsers.length > 0 && (
              <div className="divide-y border rounded-lg">
                {testUsers.map((u) => (
                  <div key={u.externalId} className="flex items-center justify-between px-3 py-2">
                    <div>
                      <p className="text-sm font-medium">{u.name}</p>
                      <p className="text-xs text-muted-foreground font-mono">{u.externalId}</p>
                    </div>
                    <button
                      onClick={() => handleRemoveUser(u.externalId)}
                      disabled={removingUserId === u.externalId}
                      className="text-muted-foreground hover:text-red-500 transition-colors disabled:opacity-40 p-1"
                    >
                      {removingUserId === u.externalId
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <Trash2 className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                ))}
              </div>
            )}
            {testUsers.length === 0 && (
              <p className="text-xs text-muted-foreground italic">No test users yet.</p>
            )}
          </CardContent>
        </Card>

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
