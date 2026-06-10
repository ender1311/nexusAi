"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Settings, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { InfoTip } from "@/components/ui/info-tip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FunnelStage,
  FUNNEL_STAGES,
  FUNNEL_STAGE_META,
  FrequencyCap,
  QuietHours,
  QuietHoursMode,
  SchedulingRule,
} from "@/types/agent";
import { AgentColorPicker } from "./agent-color-picker";
import { AgentDeeplinkOverrideField } from "./agent-deeplink-override-field";
import { resolveSegmentTargeting } from "@/lib/agent-targeting";
import { cn, formatNumber } from "@/lib/utils";
import {
  diffAgentSettings,
  SettingsSnapshot,
} from "@/lib/agents/settings-diff";

// ---- Helpers copied verbatim from scheduling-editor.tsx (not exported there).
// Keep until the legacy file is deleted in the next task.

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

const DAYS_OF_WEEK = [
  { value: 0, label: "Sun" },
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
];

function resolveInitialQuietHours(initial: SchedulingRule | null): QuietHours {
  const qh = initial?.quietHours;
  if (!qh) return { mode: "none" };
  if (qh.mode) return qh;
  const legacy = qh as { start?: string; end?: string; timezone?: string };
  if (legacy.timezone === "user") return { mode: "schedule", deliverAtHour: 8 };
  return {
    mode: "suppress",
    start: legacy.start ?? "22:00",
    end: legacy.end ?? "08:00",
    timezone: legacy.timezone ?? "America/New_York",
  };
}

const ALGORITHM_OPTIONS = [
  { value: "thompson", label: "Thompson Sampling" },
  { value: "epsilon_greedy", label: "Epsilon-Greedy" },
  { value: "linucb", label: "LinUCB" },
];

const DAILY_CAP_PRESETS = [
  { label: "No cap", value: "none" },
  { label: "100", value: "100" },
  { label: "250", value: "250" },
  { label: "500", value: "500" },
  { label: "1,000", value: "1000" },
  { label: "2,500", value: "2500" },
  { label: "5,000", value: "5000" },
  { label: "10,000", value: "10000" },
  { label: "50,000", value: "50000" },
  { label: "Custom…", value: "custom" },
];

const MODE_OPTIONS: { value: QuietHoursMode; label: string; description: string }[] = [
  { value: "none", label: "Off", description: "No quiet hours. Nexus picks best behavioral hour per user." },
  { value: "suppress", label: "Suppress", description: "Skip users currently in the quiet window for this run." },
  { value: "schedule", label: "Schedule", description: "Braze queues all sends to fire at a fixed local hour." },
];

// ---- Segment-pick checkbox list (copied from agent-edit-sheet) -------------

type SegmentOption = { name: string; userCount: number; assignedTo: string | null };

function SegmentCheckList({
  segments,
  selected,
  currentAgentTargetNames,
  onChange,
}: {
  segments: SegmentOption[];
  selected: string[];
  currentAgentTargetNames: string[];
  onChange: (next: string[]) => void;
}) {
  if (segments.length === 0) {
    return <p className="text-sm text-muted-foreground italic">No segments synced yet — run a Hightouch segment sync first.</p>;
  }
  return (
    <div className="rounded-md border overflow-hidden max-h-48 overflow-y-auto">
      {segments.map((s) => {
        const isSelected = selected.includes(s.name);
        const isTaken = s.assignedTo !== null && !currentAgentTargetNames.includes(s.name);
        const isDisabled = isTaken && !isSelected;
        return (
          <button
            key={s.name}
            type="button"
            disabled={isDisabled}
            onClick={() => {
              onChange(isSelected ? selected.filter((n) => n !== s.name) : [...selected, s.name]);
            }}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors border-b last:border-b-0",
              isSelected ? "bg-primary/5 text-foreground" : "hover:bg-muted/50",
              isDisabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer",
            )}
          >
            <span className={cn(
              "h-4 w-4 rounded border flex-shrink-0 flex items-center justify-center",
              isSelected ? "bg-primary border-primary" : "border-input bg-background",
            )}>
              {isSelected && (
                <svg className="h-2.5 w-2.5 text-primary-foreground" fill="none" viewBox="0 0 12 12">
                  <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </span>
            <span className="flex-1 min-w-0">
              <span className="block truncate font-medium">{s.name}</span>
              <span className="block text-xs text-muted-foreground">
                {s.userCount >= 1000 ? `${(s.userCount / 1000).toFixed(0)}K` : s.userCount} users
                {isTaken && s.assignedTo ? ` · ${s.assignedTo}` : ""}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ---- Editor ----------------------------------------------------------------

export type AgentSettingsAgentProp = {
  id: string;
  name: string;
  description: string | null;
  color: string;
  algorithm: string;
  epsilon: number;
  funnelStage: FunnelStage;
  targetSegmentName: string | null;
  segmentTargeting: { includes: string[]; excludes: string[] } | null;
  enrollmentMode: "fixed" | "continuous";
  dailySendCap: number | null;
  uniqueUsersCap: number | null;
  fallbackSendHour: number | null;
  deeplinkOverride: string | null;
  languageFilter: string;
  localizePush: boolean;
  hasVerseVariants: boolean;
  usedColors: string[];
};

type Props = {
  agent: AgentSettingsAgentProp;
  initialRule: SchedulingRule | null;
  startInEditMode?: boolean;
};

export function AgentSettingsEditor({ agent, initialRule, startInEditMode }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(startInEditMode ?? false);

  // ---- form state --------------------------------------------------------
  const initialIncludes = useMemo(() => {
    if ((agent.segmentTargeting?.includes?.length ?? 0) > 0) return agent.segmentTargeting!.includes;
    return agent.targetSegmentName ? [agent.targetSegmentName] : [];
  }, [agent.segmentTargeting, agent.targetSegmentName]);
  const initialExcludes = useMemo(
    () => agent.segmentTargeting?.excludes ?? [],
    [agent.segmentTargeting],
  );
  const initialSegmentMode = initialIncludes.length > 0;

  const initialQuiet = useMemo(() => resolveInitialQuietHours(initialRule), [initialRule]);
  const initialFreqCap: FrequencyCap = initialRule?.frequencyCap ?? { maxSends: 3, period: "week" };
  const initialBlackout = initialRule?.blackoutDates ?? [];
  const initialSmartSuppress = initialRule?.smartSuppress ?? false;
  const initialSuppressThresh = initialRule?.suppressThresh ?? 0.5;
  const initialPrioritizeLastSeen = initialRule?.prioritizeLastSeen ?? true;

  // Identity
  const [name, setName] = useState(agent.name);
  const [description, setDescription] = useState(agent.description ?? "");
  // Algorithm
  const [algorithm, setAlgorithm] = useState(agent.algorithm);
  const [epsilon, setEpsilon] = useState(agent.epsilon);
  // Targeting
  const [segmentMode, setSegmentMode] = useState(initialSegmentMode);
  const [funnelStage, setFunnelStage] = useState<FunnelStage>(agent.funnelStage);
  const [segmentIncludes, setSegmentIncludes] = useState<string[]>(initialIncludes);
  const [segmentExcludes, setSegmentExcludes] = useState<string[]>(initialExcludes);
  const [enrollmentMode, setEnrollmentMode] = useState<"fixed" | "continuous">(agent.enrollmentMode);
  // Sending
  // Daily cap: preset dropdown + optional custom number. Mirrors the legacy
  // agent-edit-sheet pattern so users can pick common values quickly.
  const initialCapPreset = useMemo(() => {
    if (agent.dailySendCap === null) return "none";
    return DAILY_CAP_PRESETS.find((o) => o.value === String(agent.dailySendCap))
      ? String(agent.dailySendCap)
      : "custom";
  }, [agent.dailySendCap]);
  const [capPreset, setCapPreset] = useState(initialCapPreset);
  const [capCustom, setCapCustom] = useState(
    agent.dailySendCap !== null && initialCapPreset === "custom" ? String(agent.dailySendCap) : "",
  );
  const [uniqueUsersCapInput, setUniqueUsersCapInput] = useState<string>(
    agent.uniqueUsersCap == null ? "" : String(agent.uniqueUsersCap),
  );
  const [fallbackSendHour, setFallbackSendHour] = useState<number>(agent.fallbackSendHour ?? 8);
  const [deeplinkOverride, setDeeplinkOverride] = useState(agent.deeplinkOverride ?? "");
  // Guardrails
  const [freqCap, setFreqCap] = useState<FrequencyCap>(initialFreqCap);
  const [quietHours, setQuietHours] = useState<QuietHours>(initialQuiet);
  const [blackoutDates, setBlackoutDates] = useState<string[]>(initialBlackout);
  const [newBlackout, setNewBlackout] = useState("");
  const [smartSuppress, setSmartSuppress] = useState(initialSmartSuppress);
  const [suppressThresh, setSuppressThresh] = useState(initialSuppressThresh);
  const [prioritizeLastSeen, setPrioritizeLastSeen] = useState(initialPrioritizeLastSeen);

  // Segment options
  const [segments, setSegments] = useState<SegmentOption[]>([]);
  const segmentsFetched = useRef(false);
  useEffect(() => {
    if (!editing || segmentsFetched.current) return;
    segmentsFetched.current = true;
    fetch("/api/segments")
      .then((r) => r.json())
      .then((j: { data: SegmentOption[] }) => setSegments(j.data ?? []))
      .catch(() => {});
  }, [editing]);

  // Save state
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ---- snapshot builders -------------------------------------------------
  // Validate uniqueUsersCap input: empty → null (unlimited, valid); otherwise
  // must parse to integer ≥ 1. Show inline error + block Save when invalid;
  // don't silently coerce "0" / "-3" / "abc" to "unlimited".
  const uniqueUsersCapValidation: { value: number | null; error: string | null } = useMemo(() => {
    const trimmed = uniqueUsersCapInput.trim();
    if (trimmed === "") return { value: null, error: null };
    const n = Number(trimmed);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) {
      return { value: null, error: "Must be a positive whole number, or blank for unlimited." };
    }
    return { value: n, error: null };
  }, [uniqueUsersCapInput]);

  // Daily cap: preset "none" → null; numeric preset → that number; "custom" →
  // capCustom must be ≥ 1, otherwise inline error blocks save.
  const dailyCapValidation: { value: number | null; error: string | null } = useMemo(() => {
    if (capPreset === "none") return { value: null, error: null };
    if (capPreset === "custom") {
      const trimmed = capCustom.trim();
      if (trimmed === "") return { value: null, error: "Enter a positive whole number, or pick 'No cap'." };
      const n = Number(trimmed);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) {
        return { value: null, error: "Must be a positive whole number." };
      }
      return { value: n, error: null };
    }
    const n = parseInt(capPreset, 10);
    return { value: n, error: null };
  }, [capPreset, capCustom]);

  // color saves out-of-band via AgentColorPicker; localizePush has no input in
  // this form. Both are intentionally excluded from snapshots so this form's
  // PATCH can never accidentally clobber them. Preserve agent.targetSegmentName
  // verbatim so a no-op save never triggers releasesCohort on legacy agents.
  //
  // Stored in state (not just useMemo) so that on a partial save failure (PATCH
  // succeeded but PUT failed) we can advance the agent-side baseline to the
  // just-saved values; the recomputed diff then only contains scheduling and
  // the retry doesn't re-PATCH already-saved fields.
  // Each field here must use the SAME normalization as currentSnapshot
  // (trim, null-for-empty, ?? defaults) or a no-op open-and-save would
  // produce a phantom diff and silently PATCH untouched fields.
  const buildInitialSnapshot = (): SettingsSnapshot => ({
    name: agent.name.trim(),
    description: agent.description && agent.description.trim() !== "" ? agent.description.trim() : null,
    algorithm: agent.algorithm,
    epsilon: agent.epsilon,
    funnelStage: agent.funnelStage,
    targetSegmentName: agent.targetSegmentName,
    segmentTargeting: initialSegmentMode
      ? { includes: initialIncludes, excludes: initialExcludes }
      : null,
    enrollmentMode: agent.enrollmentMode,
    dailySendCap: agent.dailySendCap,
    uniqueUsersCap: agent.uniqueUsersCap,
    fallbackSendHour: agent.fallbackSendHour ?? 8,
    deeplinkOverride: agent.deeplinkOverride,
    languageFilter: agent.languageFilter,
    frequencyCap: initialFreqCap,
    quietHours: initialQuiet,
    blackoutDates: initialBlackout,
    smartSuppress: initialSmartSuppress,
    suppressThresh: initialSuppressThresh,
    prioritizeLastSeen: initialPrioritizeLastSeen,
  });
  const [initialSnapshot, setInitialSnapshot] = useState<SettingsSnapshot>(buildInitialSnapshot);

  const currentSnapshot: SettingsSnapshot = useMemo(() => ({
    name: name.trim(),
    description: description.trim() === "" ? null : description.trim(),
    algorithm,
    epsilon,
    funnelStage,
    // Deliberate funnel<->segment mode switch clears the legacy field; same-mode
    // edits preserve it verbatim so a no-op save never triggers releasesCohort.
    targetSegmentName: segmentMode === initialSegmentMode ? agent.targetSegmentName : null,
    segmentTargeting: resolveSegmentTargeting(segmentMode, segmentIncludes, segmentExcludes),
    enrollmentMode,
    dailySendCap: dailyCapValidation.value,
    uniqueUsersCap: uniqueUsersCapValidation.value,
    fallbackSendHour,
    deeplinkOverride: deeplinkOverride.trim() === "" ? null : deeplinkOverride.trim(),
    languageFilter: agent.languageFilter, // not yet editable in this tab; preserve
    frequencyCap: freqCap,
    quietHours,
    blackoutDates,
    smartSuppress,
    suppressThresh,
    prioritizeLastSeen,
  }), [
    name, description, algorithm, epsilon, funnelStage,
    agent.targetSegmentName, initialSegmentMode,
    segmentMode, segmentIncludes, segmentExcludes, enrollmentMode,
    dailyCapValidation.value, uniqueUsersCapValidation.value, fallbackSendHour, deeplinkOverride,
    agent.languageFilter,
    freqCap, quietHours, blackoutDates, smartSuppress, suppressThresh, prioritizeLastSeen,
  ]);

  const diff = useMemo(() => diffAgentSettings(initialSnapshot, currentSnapshot), [initialSnapshot, currentSnapshot]);
  const isDirty = diff.agentPatch !== null || diff.schedulingPut !== null;

  // Targeting/enrollment change → server will release cohort. Warn user.
  const willReleaseCohort = useMemo(() => {
    if (!diff.agentPatch) return false;
    return (
      "funnelStage" in diff.agentPatch ||
      "segmentTargeting" in diff.agentPatch ||
      "targetSegmentName" in diff.agentPatch ||
      "enrollmentMode" in diff.agentPatch
    );
  }, [diff.agentPatch]);

  function selectQuietMode(mode: QuietHoursMode) {
    if (mode === "none") {
      setQuietHours({ mode: "none" });
    } else if (mode === "suppress") {
      setQuietHours((q) => ({
        mode: "suppress",
        start: q.start ?? "22:00",
        end: q.end ?? "08:00",
        timezone: q.timezone ?? "America/New_York",
        quietDays: q.quietDays,
      }));
    } else {
      setQuietHours((q) => ({ mode: "schedule", deliverAtHour: q.deliverAtHour ?? 8 }));
    }
  }

  function resetForm() {
    setName(agent.name);
    setDescription(agent.description ?? "");
    setAlgorithm(agent.algorithm);
    setEpsilon(agent.epsilon);
    setFunnelStage(agent.funnelStage);
    setSegmentMode(initialSegmentMode);
    setSegmentIncludes(initialIncludes);
    setSegmentExcludes(initialExcludes);
    setEnrollmentMode(agent.enrollmentMode);
    setCapPreset(initialCapPreset);
    setCapCustom(agent.dailySendCap !== null && initialCapPreset === "custom" ? String(agent.dailySendCap) : "");
    setUniqueUsersCapInput(agent.uniqueUsersCap == null ? "" : String(agent.uniqueUsersCap));
    setFallbackSendHour(agent.fallbackSendHour ?? 8);
    setDeeplinkOverride(agent.deeplinkOverride ?? "");
    setFreqCap(initialFreqCap);
    setQuietHours(initialQuiet);
    setBlackoutDates(initialBlackout);
    setNewBlackout("");
    setSmartSuppress(initialSmartSuppress);
    setSuppressThresh(initialSuppressThresh);
    setPrioritizeLastSeen(initialPrioritizeLastSeen);
    setInitialSnapshot(buildInitialSnapshot());
    setError(null);
  }

  async function onSave() {
    setSaving(true);
    setError(null);
    let patchSucceeded = false;
    try {
      if (diff.agentPatch) {
        const res = await fetch(`/api/agents/${agent.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(diff.agentPatch),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? "Failed to save agent settings");
        }
        patchSucceeded = true;
      }
      if (diff.schedulingPut) {
        // The PUT route validates required fields strictly (frequencyCap,
        // quietHours, blackoutDates, suppressThresh). Send the full current
        // scheduling object whenever any scheduling field is dirty.
        const fullSchedulingPayload = {
          frequencyCap: freqCap,
          quietHours,
          blackoutDates,
          smartSuppress,
          suppressThresh,
          prioritizeLastSeen,
        };
        const res = await fetch(`/api/agents/${agent.id}/scheduling`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(fullSchedulingPayload),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? "Failed to save scheduling rules");
        }
      }
      setEditing(false);
      router.refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Save failed";
      if (patchSucceeded) {
        // Agent fields are persisted; only scheduling failed. Advance the
        // agent-side baseline to the just-saved values so retry only sends the
        // scheduling PUT (no redundant PATCH).
        setInitialSnapshot((prev) => ({
          ...prev,
          name: currentSnapshot.name,
          description: currentSnapshot.description,
          algorithm: currentSnapshot.algorithm,
          epsilon: currentSnapshot.epsilon,
          funnelStage: currentSnapshot.funnelStage,
          targetSegmentName: currentSnapshot.targetSegmentName,
          segmentTargeting: currentSnapshot.segmentTargeting,
          enrollmentMode: currentSnapshot.enrollmentMode,
          dailySendCap: currentSnapshot.dailySendCap,
          uniqueUsersCap: currentSnapshot.uniqueUsersCap,
          fallbackSendHour: currentSnapshot.fallbackSendHour,
          deeplinkOverride: currentSnapshot.deeplinkOverride,
          languageFilter: currentSnapshot.languageFilter,
        }));
        setError(`Agent settings saved, but scheduling failed: ${msg}. Click Save Changes to retry just the scheduling update.`);
      } else {
        setError(msg);
      }
    } finally {
      setSaving(false);
    }
  }

  function addBlackout() {
    if (newBlackout && !blackoutDates.includes(newBlackout)) {
      setBlackoutDates((d) => [...d, newBlackout].sort());
    }
    setNewBlackout("");
  }

  // ----- View mode --------------------------------------------------------
  if (!editing) {
    return (
      <div className="space-y-4">
        <div className="flex justify-end">
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            <Settings className="h-3.5 w-3.5 mr-1.5" />
            Edit
          </Button>
        </div>

        <Card>
          <CardHeader><CardTitle className="text-sm font-semibold">Identity</CardTitle></CardHeader>
          <CardContent>
            <Row label="Name">{agent.name}</Row>
            <Row label="Description">{agent.description ?? <span className="text-muted-foreground">—</span>}</Row>
            <Row label="Color" last>
              <span className="inline-flex items-center gap-2">
                <span className="inline-block h-3.5 w-3.5 rounded-full border border-black/10" style={{ backgroundColor: agent.color }} />
                <span className="font-mono text-xs">{agent.color}</span>
              </span>
            </Row>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm font-semibold">Algorithm</CardTitle></CardHeader>
          <CardContent>
            <Row label="Algorithm">{ALGORITHM_OPTIONS.find((a) => a.value === agent.algorithm)?.label ?? agent.algorithm}</Row>
            <Row label="Exploration rate (ε)" last>
              {agent.algorithm === "epsilon_greedy" ? `${(agent.epsilon * 100).toFixed(0)}%` : <span className="text-muted-foreground">N/A</span>}
            </Row>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm font-semibold">Targeting</CardTitle></CardHeader>
          <CardContent>
            <Row label="Mode">{initialSegmentMode ? "Hightouch Segment(s)" : "Funnel Stage"}</Row>
            {initialSegmentMode ? (
              <>
                <Row label="Include">{initialIncludes.length > 0 ? initialIncludes.join(", ") : <span className="text-muted-foreground">—</span>}</Row>
                <Row label="Exclude">{initialExcludes.length > 0 ? initialExcludes.join(", ") : <span className="text-muted-foreground">—</span>}</Row>
              </>
            ) : (
              <Row label="Funnel Stage">{FUNNEL_STAGE_META[agent.funnelStage]?.label ?? agent.funnelStage}</Row>
            )}
            <Row label="Enrollment Mode" last>{agent.enrollmentMode === "fixed" ? "Fixed Cohort" : "Continuous (trigger-based)"}</Row>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm font-semibold">Sending</CardTitle></CardHeader>
          <CardContent>
            <Row label="Daily Send Cap">{agent.dailySendCap != null ? formatNumber(agent.dailySendCap) : "Unlimited"}</Row>
            <Row label="Max Unique Users">{agent.uniqueUsersCap != null ? formatNumber(agent.uniqueUsersCap) : "Unlimited"}</Row>
            <Row label="Fallback Send Hour">{agent.fallbackSendHour != null ? formatHour(agent.fallbackSendHour) : formatHour(8)}</Row>
            <Row label="Deeplink Override">{agent.deeplinkOverride ? <code className="text-xs">{agent.deeplinkOverride}</code> : <span className="text-muted-foreground">—</span>}</Row>
            <Row label="Language Filter">{agent.languageFilter === "all" ? "All" : agent.languageFilter}</Row>
            <Row label="Localize Push" last>{agent.localizePush ? "On" : "Off"}</Row>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm font-semibold">Guardrails</CardTitle></CardHeader>
          <CardContent>
            <Row label="Frequency Cap">{initialFreqCap.maxSends}× {PERIOD_LABELS[initialFreqCap.period] ?? initialFreqCap.period}</Row>
            <Row label="Quiet Hours">
              {initialQuiet.mode === "none" && "Off"}
              {initialQuiet.mode === "suppress" && `Suppress ${initialQuiet.start ?? "—"}–${initialQuiet.end ?? "—"} (${initialQuiet.timezone ?? "—"})`}
              {initialQuiet.mode === "schedule" && `Deliver at ${formatHour(initialQuiet.deliverAtHour ?? 8)} local`}
            </Row>
            <Row label="Blackout Dates">{initialBlackout.length > 0 ? initialBlackout.join(", ") : <span className="text-muted-foreground">None</span>}</Row>
            <Row label="Smart Suppression">{initialSmartSuppress ? `Enabled (≥${(initialSuppressThresh * 100).toFixed(0)}%)` : "Disabled"}</Row>
            <Row label="Last-Seen Timing" last>{initialPrioritizeLastSeen ? "On" : "Off"}</Row>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ----- Edit mode --------------------------------------------------------
  return (
    <div className="space-y-4 pb-32">
      <div className="flex justify-end gap-2">
        <span className="text-xs text-muted-foreground self-center">Editing — unsaved changes will be lost on Cancel.</span>
      </div>

      {/* Identity */}
      <Card>
        <CardHeader><CardTitle className="text-sm font-semibold">Identity</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Agent name" />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Description</label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this agent do?"
              rows={2}
              className="resize-none text-sm"
            />
          </div>
          <AgentColorPicker agentId={agent.id} currentColor={agent.color} usedColors={agent.usedColors} />
        </CardContent>
      </Card>

      {/* Algorithm */}
      <Card>
        <CardHeader><CardTitle className="text-sm font-semibold">Algorithm</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Algorithm</label>
            <Select value={algorithm} onValueChange={(v) => { if (v) setAlgorithm(v); }}>
              <SelectTrigger className="w-full">
                <span className="flex-1 text-left text-sm truncate">
                  {ALGORITHM_OPTIONS.find((a) => a.value === algorithm)?.label ?? algorithm}
                </span>
              </SelectTrigger>
              <SelectContent>
                {ALGORITHM_OPTIONS.map((algo) => (
                  <SelectItem key={algo.value} value={algo.value}>{algo.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {algorithm === "epsilon_greedy" && (
            <div className="space-y-2 rounded-lg bg-muted/40 px-3 py-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Exploration rate</label>
                <span className="text-sm font-mono tabular-nums text-muted-foreground">
                  {(epsilon * 100).toFixed(0)}%
                </span>
              </div>
              <Slider
                min={0} max={0.5} step={0.01}
                value={[epsilon]}
                onValueChange={(v) => setEpsilon(Array.isArray(v) ? v[0] : v)}
              />
              <p className="text-xs text-muted-foreground">Fraction of sends used for random exploration vs. exploiting the best variant.</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Targeting */}
      <Card>
        <CardHeader><CardTitle className="text-sm font-semibold">Targeting</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex rounded-lg border overflow-hidden text-sm">
            <button
              type="button"
              className={cn("flex-1 py-2 text-center transition-colors", !segmentMode ? "bg-primary text-primary-foreground font-medium" : "hover:bg-muted/50 text-muted-foreground")}
              onClick={() => setSegmentMode(false)}
            >
              Funnel Stage
            </button>
            <button
              type="button"
              className={cn("flex-1 py-2 text-center transition-colors", segmentMode ? "bg-primary text-primary-foreground font-medium" : "hover:bg-muted/50 text-muted-foreground")}
              onClick={() => setSegmentMode(true)}
            >
              HT Segment
            </button>
          </div>

          {!segmentMode ? (
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Funnel Stage</label>
              <Select value={funnelStage} onValueChange={(v) => { if (v) setFunnelStage(v as FunnelStage); }}>
                <SelectTrigger className="w-full">
                  <span className="flex-1 text-left text-sm truncate">
                    {FUNNEL_STAGE_META[funnelStage]?.label ?? funnelStage}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {FUNNEL_STAGES.map((stage) => (
                    <SelectItem key={stage} value={stage}>{FUNNEL_STAGE_META[stage].label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Include Segments (AND)</label>
                <p className="text-xs text-muted-foreground">User must be in ALL selected segments.</p>
                <SegmentCheckList
                  segments={segments}
                  selected={segmentIncludes}
                  currentAgentTargetNames={initialIncludes}
                  onChange={setSegmentIncludes}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Exclude Segments (optional)</label>
                <p className="text-xs text-muted-foreground">User must NOT be in any selected segment.</p>
                <SegmentCheckList
                  segments={segments}
                  selected={segmentExcludes}
                  currentAgentTargetNames={[]}
                  onChange={setSegmentExcludes}
                />
              </div>
            </>
          )}

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Enrollment Mode</label>
            <div className="flex rounded-md border overflow-hidden text-sm">
              <button
                type="button"
                className={cn("flex-1 px-3 py-2 font-medium transition-colors",
                  enrollmentMode === "fixed" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
                onClick={() => setEnrollmentMode("fixed")}
              >
                Fixed Cohort
              </button>
              <button
                type="button"
                className={cn("flex-1 px-3 py-2 font-medium transition-colors border-l",
                  enrollmentMode === "continuous" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
                onClick={() => setEnrollmentMode("continuous")}
              >
                Continuous (trigger-based)
              </button>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {enrollmentMode === "fixed"
                ? "Locks a one-time group of up to your user cap. Users stay until they convert or hit hold limits. Best for one-off campaigns."
                : "Re-checks the segment every run: adds new matches and removes users who leave the segment. Best for always-on, behavior-triggered comms."}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Sending */}
      <Card>
        <CardHeader><CardTitle className="text-sm font-semibold">Sending</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Daily Send Cap</label>
            <div className="flex items-center gap-2">
              <Select value={capPreset} onValueChange={(v) => { if (v) setCapPreset(v); }}>
                <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DAILY_CAP_PRESETS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {capPreset === "custom" && (
                <Input
                  type="number"
                  min={1}
                  className="w-32"
                  placeholder="e.g. 750"
                  value={capCustom}
                  onChange={(e) => setCapCustom(e.target.value)}
                />
              )}
            </div>
            {dailyCapValidation.error && (
              <p className="text-xs text-destructive" role="alert">{dailyCapValidation.error}</p>
            )}
            <p className="text-xs text-muted-foreground">Maximum total sends per 24-hour UTC window.</p>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Max Unique Users</label>
            <Input
              type="number"
              min={1}
              placeholder="Unlimited"
              value={uniqueUsersCapInput}
              onChange={(e) => setUniqueUsersCapInput(e.target.value)}
              aria-invalid={uniqueUsersCapValidation.error !== null}
            />
            {uniqueUsersCapValidation.error && (
              <p className="text-xs text-destructive" role="alert">{uniqueUsersCapValidation.error}</p>
            )}
            <p className="text-xs text-muted-foreground">
              Lifetime ceiling on distinct users this agent will enroll. Leave blank for unlimited.
              Lowering it does not release already-enrolled users.
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Fallback Send Hour</label>
            <Select value={String(fallbackSendHour)} onValueChange={(v) => v && setFallbackSendHour(parseInt(v, 10))}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                {HOUR_OPTIONS.map((h) => (
                  <SelectItem key={h.value} value={String(h.value)}>{h.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Braze delivers at this hour in each user&apos;s local timezone. Users with app usage history receive pushes timed to their session window instead.
            </p>
          </div>

          <AgentDeeplinkOverrideField
            value={deeplinkOverride}
            onChange={setDeeplinkOverride}
            hasVerseVariants={agent.hasVerseVariants}
          />
        </CardContent>
      </Card>

      {/* Guardrails */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
            Frequency Cap
            <InfoTip title="Frequency Cap">
              <p>Limits how many messages a user can receive from this agent in a rolling time window — regardless of how many cron runs fire.</p>
              <p className="mt-1">The window is <strong>rolling</strong>, not calendar-based. 3 per week means the user hasn&apos;t received a message in the last 7 days more than 3 times.</p>
              <p className="mt-1">Set this conservatively. Over-messaging drives unsubscribes and negative rewards that hurt your bandit&apos;s arm statistics.</p>
            </InfoTip>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
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
              <SelectTrigger className="w-full sm:w-36"><SelectValue /></SelectTrigger>
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

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
            Quiet Hours
            <InfoTip title="Quiet Hours">
              <p><strong>Off</strong> — No enforcement. Nexus picks the best behavioral hour per user; users without data use Braze&apos;s in-local-time fallback.</p>
              <p className="mt-1"><strong>Suppress</strong> — Server-side window check at send time. If a user&apos;s local time (from Hightouch) is inside the window, they&apos;re skipped for that cron run entirely. Good when some users missing a send is acceptable.</p>
              <p className="mt-1"><strong>Schedule</strong> — Braze queues all messages and delivers at your chosen hour in each user&apos;s own timezone via <code>in_local_time</code>. No one is suppressed — delivery is just delayed to a reasonable hour. Requires Braze to have good timezone coverage.</p>
            </InfoTip>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {MODE_OPTIONS.map((opt) => {
              const selected = quietHours.mode === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => selectQuietMode(opt.value)}
                  className={cn(
                    "text-left rounded-lg border p-3 transition-colors",
                    selected ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border hover:border-primary/50 hover:bg-muted/50",
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

          {quietHours.mode === "suppress" && (
            <>
              <div className="flex flex-wrap gap-3 pt-1">
                <div className="flex-1 min-w-[7rem]">
                  <label className="text-xs text-muted-foreground block mb-1">From</label>
                  <Input
                    type="time"
                    value={quietHours.start ?? "22:00"}
                    onChange={(e) => setQuietHours((q) => ({ ...q, start: e.target.value }))}
                  />
                </div>
                <div className="flex-1 min-w-[7rem]">
                  <label className="text-xs text-muted-foreground block mb-1">To</label>
                  <Input
                    type="time"
                    value={quietHours.end ?? "08:00"}
                    onChange={(e) => setQuietHours((q) => ({ ...q, end: e.target.value }))}
                  />
                </div>
                <div className="flex-1 min-w-[11rem]">
                  <label className="text-xs text-muted-foreground block mb-1">Fallback timezone</label>
                  <Select
                    value={quietHours.timezone ?? "America/New_York"}
                    onValueChange={(v) => v && setQuietHours((q) => ({ ...q, timezone: v }))}
                  >
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
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
              <div className="space-y-2 pt-2">
                <label className="text-xs text-muted-foreground block">Quiet Days</label>
                <div className="flex gap-2 flex-wrap">
                  {DAYS_OF_WEEK.map((d) => {
                    const suppressed = (quietHours.quietDays ?? []).includes(d.value);
                    return (
                      <button
                        key={d.value}
                        type="button"
                        onClick={() => {
                          const current = quietHours.quietDays ?? [];
                          setQuietHours((q) => ({
                            ...q,
                            quietDays: suppressed ? current.filter((x) => x !== d.value) : [...current, d.value],
                          }));
                        }}
                        className={cn(
                          "px-3 py-1.5 text-xs rounded-md border font-medium transition-colors",
                          suppressed
                            ? "bg-destructive/10 border-destructive/40 text-destructive"
                            : "bg-background border-input text-muted-foreground hover:border-primary/50 hover:text-foreground",
                        )}
                      >
                        {d.label}
                      </button>
                    );
                  })}
                </div>
                {(quietHours.quietDays ?? []).length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    No sends on:{" "}
                    {(quietHours.quietDays ?? [])
                      .slice()
                      .sort((a, b) => a - b)
                      .map((d) => DAYS_OF_WEEK.find((x) => x.value === d)?.label)
                      .join(", ")}
                  </p>
                )}
              </div>
            </>
          )}

          {quietHours.mode === "schedule" && (
            <div className="pt-1 max-w-[12rem]">
              <label className="text-xs text-muted-foreground block mb-1">Deliver at (local time)</label>
              <Select
                value={String(quietHours.deliverAtHour ?? 8)}
                onValueChange={(v) => v && setQuietHours((q) => ({ ...q, deliverAtHour: parseInt(v, 10) }))}
              >
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
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

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
            Blackout Dates
            <InfoTip title="Blackout Dates">
              <p>Specific calendar dates on which <strong>no messages are sent</strong> from this agent, regardless of any other scheduling rules.</p>
              <p className="mt-1">Use for major holidays, company-wide communication freezes, or any date where messaging would be insensitive or unwanted. Dates apply globally to all users of this agent.</p>
            </InfoTip>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              type="date"
              value={newBlackout}
              onChange={(e) => setNewBlackout(e.target.value)}
              className="flex-1 min-w-[8rem]"
            />
            <Button size="sm" variant="outline" onClick={addBlackout} disabled={!newBlackout}>Add</Button>
          </div>
          {blackoutDates.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {blackoutDates.map((d) => (
                <Badge key={d} variant="outline" className="text-xs gap-1">
                  {d}
                  <button onClick={() => setBlackoutDates((dates) => dates.filter((x) => x !== d))} aria-label={`Remove blackout date ${d}`}>
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
              Low-Probability Suppression
              <InfoTip title="Low-Probability Suppression">
                <p>Skips users whose historical engagement predicts a very low probability of converting. This concentrates sends on users more likely to respond, improving your overall conversion rate.</p>
                <p className="mt-1">The threshold is compared against the user&apos;s <strong>average reward</strong> across their last 5+ decisions with this agent. Only activates once a user has enough history.</p>
                <p className="mt-1">A threshold of 20% means users whose predicted conversion is below 20% are skipped for this run. They can still receive messages in future runs if their behavior changes.</p>
              </InfoTip>
            </CardTitle>
            <Switch checked={smartSuppress} onCheckedChange={setSmartSuppress} />
          </div>
        </CardHeader>
        {smartSuppress && (
          <CardContent>
            <label className="text-xs text-muted-foreground">
              Minimum predicted conversion: {(suppressThresh * 100).toFixed(0)}%
            </label>
            <Slider
              min={0.05} max={0.9} step={0.05}
              value={[suppressThresh]}
              onValueChange={(v) => setSuppressThresh(Array.isArray(v) ? v[0] : v)}
              className="mt-1"
            />
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
              Last-Seen Timing
              <InfoTip title="Last-Seen Timing">
                <p>When enabled, the audience cap fills with users whose last-seen activity time matches the current hour first — then falls back to users with no timing data.</p>
                <p className="mt-1">This distributes sends throughout the day at each user&apos;s natural engagement time rather than clustering at the fallback hour. Users without last-seen data are still included once time-matched slots are filled.</p>
                <p className="mt-1">When disabled, the audience cap is filled randomly (original lottery behavior) and sends fire at the fallback hour for all users.</p>
              </InfoTip>
            </CardTitle>
            <Switch checked={prioritizeLastSeen} onCheckedChange={setPrioritizeLastSeen} />
          </div>
        </CardHeader>
        {prioritizeLastSeen && (
          <CardContent>
            <p className="text-xs text-muted-foreground bg-muted rounded-md p-2">
              Each hourly run fills the audience cap with users last seen around that hour first.
            </p>
          </CardContent>
        )}
      </Card>

      {/* Sticky save bar */}
      <div className="fixed bottom-0 left-0 right-0 z-30 border-t bg-background/95 backdrop-blur px-4 sm:px-6 py-3 space-y-2 shadow-md">
        {willReleaseCohort && (
          <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded px-2 py-1.5">
            ⚠ Targeting or enrollment-mode change detected. Saving will release this agent&apos;s
            current cohort (existing locks cleared, active assignments released as manual) and
            re-materialize on the next active cron tick.
          </p>
        )}
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        <div className="flex gap-2 max-w-2xl ml-auto justify-end">
          <Button variant="outline" disabled={saving} onClick={() => { resetForm(); setEditing(false); }}>
            Cancel
          </Button>
          <Button
            disabled={
              saving ||
              !isDirty ||
              !name.trim() ||
              (segmentMode && segmentIncludes.length === 0) ||
              uniqueUsersCapValidation.error !== null ||
              dailyCapValidation.error !== null
            }
            onClick={() => void onSave()}
          >
            {saving ? "Saving…" : "Save Changes"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---- Tiny presentational helpers -------------------------------------------

function Row({ label, children, last }: { label: string; children: React.ReactNode; last?: boolean }) {
  return (
    <div className={cn("flex justify-between gap-4 py-2.5", !last && "border-b")}>
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-right">{children}</span>
    </div>
  );
}

function formatHour(hour: number): string {
  if (hour === 0) return "12:00 AM";
  if (hour < 12) return `${hour}:00 AM`;
  if (hour === 12) return "12:00 PM";
  return `${hour - 12}:00 PM`;
}
