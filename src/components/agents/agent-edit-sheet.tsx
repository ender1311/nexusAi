"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { FunnelStage, FUNNEL_STAGES, FUNNEL_STAGE_META } from "@/types/agent";
import { AgentColorPicker } from "./agent-color-picker";
import { AgentDeeplinkOverrideField } from "./agent-deeplink-override-field";
import { resolveSegmentTargeting } from "@/lib/agent-targeting";
import { cn } from "@/lib/utils";

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
        // A segment is "taken" if it's assigned to another agent AND not in current agent's own targets
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
            {/* Checkbox indicator */}
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

type Props = {
  agentId: string;
  initialName: string;
  initialDescription: string | null;
  initialAlgorithm: string;
  initialEpsilon: number;
  initialFunnelStage: FunnelStage;
  initialColor: string;
  usedColors: string[];
  initialTargetSegmentName: string | null;
  initialSegmentTargeting: { includes: string[]; excludes: string[] } | null;
  initialDailySendCap: number | null;
  initialDeeplinkOverride: string | null;
  hasVerseVariants: boolean;
};

export function AgentEditSheet({
  agentId,
  initialName,
  initialDescription,
  initialAlgorithm,
  initialEpsilon,
  initialFunnelStage,
  initialColor,
  usedColors,
  initialTargetSegmentName,
  initialSegmentTargeting,
  initialDailySendCap,
  initialDeeplinkOverride,
  hasVerseVariants,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription ?? "");
  const [algorithm, setAlgorithm] = useState(initialAlgorithm);
  const [epsilon, setEpsilon] = useState(initialEpsilon);
  const [funnelStage, setFunnelStage] = useState<FunnelStage>(initialFunnelStage);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Compute initial includes/excludes for segment targeting
  const computeInitialIncludes = () => {
    if ((initialSegmentTargeting?.includes?.length ?? 0) > 0) {
      return initialSegmentTargeting!.includes;
    }
    return initialTargetSegmentName ? [initialTargetSegmentName] : [];
  };
  const computeInitialExcludes = () => initialSegmentTargeting?.excludes ?? [];

  // Segment targeting
  const hasInitialSegmentMode = (initialSegmentTargeting?.includes?.length ?? 0) > 0 || initialTargetSegmentName !== null;
  const [segmentMode, setSegmentMode] = useState(hasInitialSegmentMode);
  const [segmentIncludes, setSegmentIncludes] = useState<string[]>(computeInitialIncludes);
  const [segmentExcludes, setSegmentExcludes] = useState<string[]>(computeInitialExcludes);
  const [segments, setSegments] = useState<SegmentOption[]>([]);

  // Daily send cap
  const initialCapPreset = initialDailySendCap === null
    ? "none"
    : DAILY_CAP_PRESETS.find((o) => o.value === String(initialDailySendCap))
      ? String(initialDailySendCap)
      : "custom";
  const [capPreset, setCapPreset] = useState(initialCapPreset);
  const [capCustom, setCapCustom] = useState(
    initialDailySendCap !== null && initialCapPreset === "custom" ? String(initialDailySendCap) : ""
  );

  // Bulk deeplink override ("" = no override)
  const [deeplinkOverride, setDeeplinkOverride] = useState(initialDeeplinkOverride ?? "");

  // Reset form state when sheet opens
  const prevOpen = useRef(false);
  useEffect(() => {
    if (open && !prevOpen.current) {
      setSaveError(null);
      setName(initialName);
      setDescription(initialDescription ?? "");
      setAlgorithm(initialAlgorithm);
      setEpsilon(initialEpsilon);
      setFunnelStage(initialFunnelStage);
      const recomputedHasSegmentMode = (initialSegmentTargeting?.includes?.length ?? 0) > 0 || initialTargetSegmentName !== null;
      setSegmentMode(recomputedHasSegmentMode);
      setSegmentIncludes(computeInitialIncludes());
      setSegmentExcludes(computeInitialExcludes());
      setCapPreset(initialCapPreset);
      setCapCustom(initialDailySendCap !== null && initialCapPreset === "custom" ? String(initialDailySendCap) : "");
      setDeeplinkOverride(initialDeeplinkOverride ?? "");
    }
    prevOpen.current = open;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialName, initialDescription, initialAlgorithm, initialEpsilon, initialFunnelStage,
      initialTargetSegmentName, initialSegmentTargeting, initialDailySendCap, initialCapPreset,
      initialDeeplinkOverride]);

  // Fetch segments when sheet opens
  useEffect(() => {
    if (!open) return;
    fetch("/api/segments")
      .then((r) => r.json())
      .then((j: { data: SegmentOption[] }) => setSegments(j.data))
      .catch(() => {});
  }, [open]);

  function resolvedDailySendCap(): number | null {
    if (capPreset === "none") return null;
    if (capPreset === "custom") {
      const n = parseInt(capCustom, 10);
      return !isNaN(n) && n >= 1 ? n : null;
    }
    return parseInt(capPreset, 10);
  }

  async function save() {
    if (!name.trim()) return;
    setSaving(true);
    setSaveError(null);
    try {
      const resolvedSegmentTargeting = resolveSegmentTargeting(segmentMode, segmentIncludes, segmentExcludes);
      const res = await fetch(`/api/agents/${agentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          algorithm,
          epsilon,
          funnelStage,
          targetSegmentName: null,  // always clear legacy field when using new UI
          segmentTargeting: resolvedSegmentTargeting,
          dailySendCap: resolvedDailySendCap(),
          deeplinkOverride: deeplinkOverride.trim() === "" ? null : deeplinkOverride.trim(),
        }),
      });
      if (!res.ok) {
        // Surface server-side validation/conflict errors (e.g. 409 segment
        // already assigned to another agent) instead of silently "saving".
        const body = await res.json().catch(() => null);
        setSaveError(body?.error ?? "Failed to save changes. Please try again.");
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setSaveError("Network error — please try again.");
    } finally {
      setSaving(false);
    }
  }

  // The current agent's own includes — used to allow re-selecting already-assigned segments
  const initialIncludes = computeInitialIncludes();

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button variant="outline" size="sm">
            <Settings className="h-3.5 w-3.5 mr-1.5" />
            Edit
          </Button>
        }
      />
      <SheetContent className="w-full sm:max-w-md flex flex-col overflow-hidden p-0">
        <SheetHeader className="px-6 pt-6 pb-4 border-b shrink-0">
          <SheetTitle className="text-base">Edit Agent</SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {/* Identity */}
          <section className="space-y-4">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Identity</p>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Name</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Agent name"
              />
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
            <AgentColorPicker agentId={agentId} currentColor={initialColor} usedColors={usedColors} />
          </section>

          <div className="border-t" />

          {/* Configuration */}
          <section className="space-y-4">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Configuration</p>

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
                    <SelectItem key={algo.value} value={algo.value}>
                      {algo.label}
                    </SelectItem>
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
                  min={0}
                  max={0.5}
                  step={0.01}
                  value={[epsilon]}
                  onValueChange={(v) => setEpsilon(Array.isArray(v) ? v[0] : v)}
                />
                <p className="text-xs text-muted-foreground">Fraction of sends used for random exploration vs. exploiting the best variant.</p>
              </div>
            )}

          </section>

          <div className="border-t" />

          {/* Targeting */}
          <section className="space-y-4">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Targeting</p>

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
                <Select
                  value={funnelStage}
                  onValueChange={(v) => { if (v) setFunnelStage(v as FunnelStage); }}
                >
                  <SelectTrigger className="w-full">
                    <span className="flex-1 text-left text-sm truncate">
                      {FUNNEL_STAGE_META[funnelStage]?.label ?? funnelStage}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    {FUNNEL_STAGES.map((stage) => (
                      <SelectItem key={stage} value={stage}>
                        {FUNNEL_STAGE_META[stage].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Determines which users this agent targets.</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Include Segments (AND)</label>
                <p className="text-xs text-muted-foreground">User must be in ALL selected segments.</p>
                <SegmentCheckList
                  segments={segments}
                  selected={segmentIncludes}
                  currentAgentTargetNames={[...initialIncludes]}
                  onChange={setSegmentIncludes}
                />
              </div>
            )}

            {/* Exclude Segments — always show as optional */}
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
          </section>

          <div className="border-t" />

          {/* Send Limits */}
          <section className="space-y-4">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Send Limits</p>

            {/* Daily send cap */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Daily Send Cap</label>
              <div className="flex items-center gap-2">
                <Select value={capPreset} onValueChange={(v) => { if (v) setCapPreset(v); }}>
                  <SelectTrigger className="w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DAILY_CAP_PRESETS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {capPreset === "custom" && (
                  <Input
                    type="number"
                    min={1}
                    className="w-24"
                    placeholder="e.g. 750"
                    value={capCustom}
                    onChange={(e) => setCapCustom(e.target.value)}
                  />
                )}
              </div>
              <p className="text-xs text-muted-foreground">Maximum total sends per 24-hour UTC window.</p>
            </div>

            <AgentDeeplinkOverrideField
              value={deeplinkOverride}
              onChange={setDeeplinkOverride}
              hasVerseVariants={hasVerseVariants}
            />

          </section>
        </div>

        {/* Sticky footer */}
        <div className="shrink-0 border-t px-6 py-4 bg-background space-y-2">
          {saveError && (
            <p className="text-sm text-destructive" role="alert">{saveError}</p>
          )}
          <div className="flex gap-2">
            <Button
              className="flex-1"
              onClick={save}
              disabled={saving || !name.trim() || (segmentMode && segmentIncludes.length === 0)}
            >
              {saving ? "Saving…" : "Save Changes"}
            </Button>
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={saving}
            >
              Cancel
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
