"use client";

import { useState, use } from "react";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { mockAgents } from "@/lib/mock/agents";
import { FrequencyCap, QuietHours } from "@/types/agent";
import { X } from "lucide-react";

export default function SchedulingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const agent = mockAgents.find((a) => a.id === id);
  const rule = agent?.schedulingRule;

  const [freqCap, setFreqCap] = useState<FrequencyCap>(
    rule?.frequencyCap ?? { maxSends: 3, period: "week" }
  );
  const [quietHours, setQuietHours] = useState<QuietHours>(
    rule?.quietHours ?? { start: "22:00", end: "08:00", timezone: "America/New_York" }
  );
  const [blackoutDates, setBlackoutDates] = useState<string[]>(rule?.blackoutDates ?? []);
  const [newBlackout, setNewBlackout] = useState("");
  const [smartSuppress, setSmartSuppress] = useState(rule?.smartSuppress ?? false);
  const [suppressThresh, setSuppressThresh] = useState(rule?.suppressThresh ?? 0.5);

  const addBlackout = () => {
    if (newBlackout && !blackoutDates.includes(newBlackout)) {
      setBlackoutDates((d) => [...d, newBlackout].sort());
    }
    setNewBlackout("");
  };

  return (
    <>
      <Header title="Scheduling & Guardrails" description={agent?.name} />
      <div className="p-6 max-w-2xl space-y-6">
        {/* Frequency Cap */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold">Frequency Cap</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Limit how many messages a user can receive per time period.
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
              <Select value={freqCap.period} onValueChange={(v) => setFreqCap((f) => ({ ...f, period: v as FrequencyCap["period"] }))}>
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
            <p className="text-xs text-muted-foreground bg-muted rounded-md p-2">
              Current: <strong>max {freqCap.maxSends} sends per {freqCap.period}</strong>
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
              No messages will be sent during these hours (in the user&apos;s local time).
            </p>
            <div className="flex items-center gap-3 flex-wrap">
              <div>
                <label className="text-xs text-muted-foreground">From</label>
                <Input
                  type="time"
                  value={quietHours.start}
                  onChange={(e) => setQuietHours((q) => ({ ...q, start: e.target.value }))}
                  className="mt-1 w-32"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">To</label>
                <Input
                  type="time"
                  value={quietHours.end}
                  onChange={(e) => setQuietHours((q) => ({ ...q, end: e.target.value }))}
                  className="mt-1 w-32"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Timezone</label>
                <Select value={quietHours.timezone} onValueChange={(v) => v && setQuietHours((q) => ({ ...q, timezone: v }))}>
                  <SelectTrigger className="mt-1 w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="America/New_York">Eastern (ET)</SelectItem>
                    <SelectItem value="America/Chicago">Central (CT)</SelectItem>
                    <SelectItem value="America/Denver">Mountain (MT)</SelectItem>
                    <SelectItem value="America/Los_Angeles">Pacific (PT)</SelectItem>
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
              No messages will be sent on these specific dates.
            </p>
            <div className="flex gap-2">
              <Input
                type="date"
                value={newBlackout}
                onChange={(e) => setNewBlackout(e.target.value)}
                className="w-44"
              />
              <Button size="sm" variant="outline" onClick={addBlackout} disabled={!newBlackout}>
                Add Date
              </Button>
            </div>
            {blackoutDates.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {blackoutDates.map((d) => (
                  <Badge key={d} variant="outline" className="text-xs gap-1">
                    {d}
                    <button onClick={() => setBlackoutDates((dates) => dates.filter((x) => x !== d))}>
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
              <CardTitle className="text-sm font-semibold">Smart Suppression</CardTitle>
              <Switch checked={smartSuppress} onCheckedChange={setSmartSuppress} />
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Suppress messages for users with predicted conversion probability below a threshold.
              Reduces noise and focuses budget on highest-value sends.
            </p>
            {smartSuppress && (
              <div>
                <label className="text-xs text-muted-foreground">
                  Min predicted conversion: {(suppressThresh * 100).toFixed(0)}%
                </label>
                <Slider
                  min={0.05} max={0.9} step={0.05}
                  value={[suppressThresh]}
                  onValueChange={(v) => setSuppressThresh(Array.isArray(v) ? v[0] : v)}
                  className="mt-1"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Only users with ≥{(suppressThresh * 100).toFixed(0)}% predicted conversion will receive messages.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex gap-2">
          <Button size="sm">Save Rules</Button>
          <Button size="sm" variant="outline">Cancel</Button>
        </div>
      </div>
    </>
  );
}
