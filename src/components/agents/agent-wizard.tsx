"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn, formatNumber } from "@/lib/utils";
import { Check, ChevronRight, Bot, Target, MessageSquare, Calendar, Rocket, Pencil } from "lucide-react";
import { GoalTier, Channel, FrequencyCap, FunnelStage, FUNNEL_STAGES, FUNNEL_STAGE_META, Algorithm } from "@/types/agent";
import { estimateConvergence } from "@/lib/convergence";
import type { Persona } from "@/types/persona";
import { PersonaSelector } from "@/components/personas/persona-selector";
import { PersonaBadge } from "@/components/personas/persona-badge";
import { GoalPresetPicker } from "@/components/agents/goal-preset-picker";
import { TemplatePicker, type TemplatePickerHandle } from "@/components/agents/template-picker";
import { YouVersionGoalPreset } from "@/lib/constants/youversion";
import { resolveSegmentTargeting } from "@/lib/agent-targeting";

const STEPS = [
  { id: 1, label: "Basic Info", icon: Bot },
  { id: 2, label: "Goals", icon: Target },
  { id: 3, label: "Messages", icon: MessageSquare },
  { id: 4, label: "Scheduling", icon: Calendar },
  { id: 5, label: "Review", icon: Rocket },
];

const GOAL_TIERS: Array<{ value: GoalTier; label: string; color: string; weight: number }> = [
  { value: "best", label: "Best", color: "bg-green-500", weight: 10 },
  { value: "very_good", label: "Very Good", color: "bg-green-400", weight: 7 },
  { value: "good", label: "Good", color: "bg-blue-400", weight: 5 },
  { value: "bad", label: "Bad", color: "bg-yellow-500", weight: -2 },
  { value: "very_bad", label: "Very Bad", color: "bg-orange-500", weight: -5 },
  { value: "worst", label: "Worst", color: "bg-red-500", weight: -10 },
];

const CHANNELS: Channel[] = ["push", "email", "sms"];


const FREQ_PERIODS = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "biweek", label: "2 Weeks" },
  { value: "month", label: "Month" },
];

const DAYS_OF_WEEK = [
  { value: 0, label: "Sun" },
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
];

const ALGORITHM_OPTIONS = [
  {
    value: "thompson",
    label: "Thompson Sampling",
    badge: "Recommended",
    description:
      "Automatically balances sending proven winners vs. exploring new variants. Learns which messages resonate with each persona segment over time and shifts more sends toward the best performers — without requiring manual A/B test management.",
  },
  {
    value: "epsilon_greedy",
    label: "Epsilon-Greedy",
    badge: null,
    description:
      "Sends the current best-performing variant most of the time, and randomly tries other variants a small percentage of the time (controlled by epsilon). Simpler than Thompson Sampling but less adaptive — you control how much exploration happens.",
  },
  {
    value: "linucb",
    label: "LinUCB",
    badge: null,
    description:
      "Contextual bandit that learns a linear reward model per variant using the user's 10-dimensional behavioral feature vector. Adapts to individual user context rather than persona-level priors — best when your user population has meaningful behavioral diversity. Requires more observations to converge than Thompson Sampling.",
  },
];

type GoalDraft = {
  eventName: string;
  tier: GoalTier;
  valueWeight: number;
  weightMode: "fixed" | "property";
  weightProperty?: string | null;
  weightDefault: number;
}

type MessageDraft = {
  name: string;
  channel: Channel;
  variants: Array<{
    name: string;
    body: string;
    subject: string;
    cta: string;
    title: string;
    deeplink: string;
    iconImageUrl: string;
    preferredHour: number | null;
    preferredDayOfWeek: number | null;
    frequencyCapOverride: FrequencyCap | null;
    sourceTemplateId?: string;
  }>;
}


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

type FormData = {
  name: string;
  description: string;
  algorithm: Algorithm;
  epsilon: number;
  funnelStage: FunnelStage | "";
  targetPersonaIds: string[];
  goals: GoalDraft[];
  messages: MessageDraft[];
  frequencyCap: { maxSends: number; period: string };
  quietStart: string;
  quietEnd: string;
  timezone: string;
  quietDays: number[];   // 0=Sunday, 6=Saturday; days to suppress sends
  smartSuppress: boolean;
  suppressThresh: number;
  uniqueUsersCap: number | null;
  dailySendCap: number | null;
  segmentMode: boolean;
  segmentIncludes: string[];
  segmentExcludes: string[];
}

const defaultForm: FormData = {
  name: "",
  description: "",
  algorithm: "thompson",
  epsilon: 0.1,
  funnelStage: "",
  targetPersonaIds: [],
  goals: [],
  messages: [],
  frequencyCap: { maxSends: 3, period: "week" },
  quietStart: "22:00",
  quietEnd: "08:00",
  timezone: "America/New_York",
  quietDays: [],
  smartSuppress: false,
  suppressThresh: 0.5,
  uniqueUsersCap: 1000,
  dailySendCap: 500,
  segmentMode: false,
  segmentIncludes: [],
  segmentExcludes: [],
};

const DAILY_SEND_CAP_PRESETS = [
  { label: "100",   value: "100" },
  { label: "500",   value: "500" },
  { label: "1K",    value: "1000" },
  { label: "5K",    value: "5000" },
  { label: "10K",   value: "10000" },
  { label: "50K",   value: "50000" },
  { label: "Custom…", value: "custom" },
  { label: "Unlimited", value: "unlimited" },
];

const UNIQUE_USERS_PRESETS = [
  { label: "1K",   value: "1000" },
  { label: "5K",   value: "5000" },
  { label: "10K",  value: "10000" },
  { label: "50K",  value: "50000" },
  { label: "100K", value: "100000" },
  { label: "500K", value: "500000" },
  { label: "Custom…", value: "custom" },
  { label: "Unlimited", value: "unlimited" },
];

export function AgentWizard({
  personas,
  pushPreferredCount = 0,
  totalUsers = 0,
}: {
  personas: Persona[];
  pushPreferredCount?: number;
  totalUsers?: number;
}) {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<FormData>(defaultForm);
  const templatePickerRef = useRef<TemplatePickerHandle>(null);
  const [editingGoalIdx, setEditingGoalIdx] = useState<number | null>(null);
  const emptyVariant = () => ({
    name: `V${1}`,
    body: "",
    subject: "",
    cta: "",
    title: "",
    deeplink: "",
    iconImageUrl: "",
    preferredHour: null,
    preferredDayOfWeek: null,
    frequencyCapOverride: null,
  });

  const [newMsg, setNewMsg] = useState<MessageDraft>({
    name: "", channel: "push",
    variants: [{ ...emptyVariant(), name: "V1" }],
  });
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [uniqueUsersPreset, setUniqueUsersPreset] = useState<string>("1000");
  const [uniqueUsersCustom, setUniqueUsersCustom] = useState<string>("");
  const [dailySendCapPreset, setDailySendCapPreset] = useState<string>("500");
  const [dailySendCapCustom, setDailySendCapCustom] = useState<string>("");
  const [segments, setSegments] = useState<SegmentOption[]>([]);

  useEffect(() => {
    fetch("/api/segments")
      .then((r) => r.json())
      .then((j: { data: SegmentOption[] }) => setSegments(j.data))
      .catch(() => {});
  }, []);

  const update = (key: keyof FormData, value: unknown) => setForm((f) => ({ ...f, [key]: value }));

  const removeGoal = (i: number) => update("goals", form.goals.filter((_, idx) => idx !== i));

  const addMessage = () => {
    if (!newMsg.name.trim() || newMsg.variants.length === 0) return;
    update("messages", [...form.messages, { ...newMsg, variants: newMsg.variants }]);
    setNewMsg({ name: "", channel: newMsg.channel, variants: [{ ...emptyVariant(), name: "V1" }] });
  };

  // Called by TemplatePicker in draft mode (push channel wizard flow)
  const addMessageFromTemplate = (msg: { name: string; channel: "push"; variants: Array<{ name: string; title?: string; body: string; deeplink?: string; sourceTemplateId: string }> }) => {
    const variantsToSave = msg.variants.map((v) => ({
      ...emptyVariant(),
      name: v.name,
      title: v.title ?? "",
      body: v.body,
      deeplink: v.deeplink ?? "",
      sourceTemplateId: v.sourceTemplateId,
    }));
    update("messages", [...form.messages, { name: msg.name, channel: "push", variants: variantsToSave }]);
  };

  const removeMessage = (i: number) => update("messages", form.messages.filter((_, idx) => idx !== i));

  // Advance a step, auto-committing any pending Step-3 message the user picked
  // but didn't explicitly "Add" (push verses live inside TemplatePicker; email/SMS
  // in the inline form). Without this, picked-but-uncommitted variants are lost.
  const goNext = () => {
    if (step === 3) {
      if (newMsg.channel === "push") {
        templatePickerRef.current?.commitPending();
      } else if (newMsg.name.trim() && newMsg.variants.length > 0) {
        addMessage();
      }
    }
    setStep((s) => Math.min(5, s + 1));
  };

  const handleSubmit = async () => {
    setSaving(true);
    setSubmitError(null);
    try {
      const payload = {
        ...form,
        targetSegmentName: null,
        segmentTargeting: resolveSegmentTargeting(form.segmentMode, form.segmentIncludes, form.segmentExcludes),
        funnelStage: form.segmentMode ? "wau" : form.funnelStage,
      };
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const agent = await res.json();
        router.push(`/agents/${agent.id}`);
      } else {
        let msg = "Failed to launch agent. Please try again.";
        try {
          const errBody = await res.json();
          if (typeof errBody?.error === "string") msg = errBody.error;
        } catch {
          // ignore parse error, use default message
        }
        setSubmitError(msg);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="w-full max-w-3xl mx-auto lg:max-w-none">
      {/* Step indicator */}
      <div className="flex items-center mb-8">
        {STEPS.map((s, i) => (
          <div key={s.id} className="flex items-center flex-1 last:flex-none">
            <button
              onClick={() => step > s.id && setStep(s.id)}
              className={cn(
                "flex items-center gap-2 text-sm font-medium transition-colors",
                step === s.id ? "text-primary" : step > s.id ? "text-muted-foreground hover:text-foreground" : "text-muted-foreground/50"
              )}
            >
              <div className={cn(
                "h-7 w-7 rounded-full flex items-center justify-center text-xs border-2 transition-colors",
                step === s.id ? "border-primary bg-primary text-primary-foreground" :
                step > s.id ? "border-primary bg-primary/10 text-primary" :
                "border-muted bg-muted text-muted-foreground"
              )}>
                {step > s.id ? <Check className="h-3.5 w-3.5" /> : s.id}
              </div>
              <span className="hidden sm:block">{s.label}</span>
            </button>
            {i < STEPS.length - 1 && (
              <div className={cn("flex-1 h-0.5 mx-2", step > s.id ? "bg-primary" : "bg-muted")} />
            )}
          </div>
        ))}
      </div>

      {/* Top navigation */}
      <div className="flex items-center justify-between mb-6 pb-4 border-b">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setStep((s) => Math.max(1, s - 1))}
          disabled={step === 1}
        >
          Back
        </Button>
        {step < 5 ? (
          <Button
            size="sm"
            onClick={goNext}
            disabled={step === 1 && (!form.name.trim() || (form.segmentMode ? form.segmentIncludes.length === 0 : !form.funnelStage))}
          >
            Next
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        ) : (
          <div className="flex flex-col items-end gap-1">
            <Button size="sm" onClick={handleSubmit} disabled={saving || !form.name.trim()}>
              {saving ? "Saving..." : "Launch Agent"}
              <Rocket className="h-4 w-4 ml-1" />
            </Button>
            {submitError && <p className="text-sm text-red-500 mt-2">{submitError}</p>}
          </div>
        )}
      </div>

      {/* Step 1: Basic Info */}
      {step === 1 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Basic Information</h2>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium">Agent Name *</label>
              <Input
                className="mt-1"
                placeholder="e.g. Recommend Bible Plans"
                value={form.name}
                onChange={(e) => update("name", e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Description</label>
              <Input
                className="mt-1"
                placeholder="What does this agent do?"
                value={form.description}
                onChange={(e) => update("description", e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Algorithm</label>
              <Select value={form.algorithm} onValueChange={(v) => update("algorithm", v)}>
                <SelectTrigger className="mt-1 w-full">
                  <span className="flex-1 text-left text-sm truncate">
                    {ALGORITHM_OPTIONS.find((a) => a.value === form.algorithm)?.label ?? form.algorithm}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {ALGORITHM_OPTIONS.map((algo) => (
                    <SelectItem key={algo.value} value={algo.value}>
                      <span className="flex items-center gap-2">
                        {algo.label}
                        {algo.badge && (
                          <span className="text-[10px] bg-primary/10 text-primary rounded px-1.5 py-0.5 font-medium">
                            {algo.badge}
                          </span>
                        )}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {(() => {
                const algo = ALGORITHM_OPTIONS.find((a) => a.value === form.algorithm);
                return algo ? (
                  <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                    {algo.description}
                  </p>
                ) : null;
              })()}
            </div>
            {form.algorithm === "epsilon_greedy" && (
              <div>
                <label className="text-sm font-medium">Epsilon (exploration rate): {(form.epsilon * 100).toFixed(0)}%</label>
                <Slider
                  className="mt-2"
                  min={0}
                  max={0.5}
                  step={0.01}
                  value={[form.epsilon]}
                  onValueChange={(v) => update("epsilon", Array.isArray(v) ? v[0] : v)}
                />
              </div>
            )}
            {/* Targeting Mode */}
            <div>
              <label className="text-sm font-medium">Targeting Mode</label>
              <p className="text-xs text-muted-foreground mt-0.5 mb-2">
                Target users by funnel stage or by a Hightouch audience segment.
              </p>
              <div className="flex rounded-md border overflow-hidden text-sm mb-2">
                <button
                  type="button"
                  className={cn("flex-1 px-3 py-2 font-medium transition-colors",
                    !form.segmentMode
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground")}
                  onClick={() => update("segmentMode", false)}
                >
                  Funnel Stage
                </button>
                <button
                  type="button"
                  className={cn("flex-1 px-3 py-2 font-medium transition-colors border-l",
                    form.segmentMode
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground")}
                  onClick={() => update("segmentMode", true)}
                >
                  HT Segment
                </button>
              </div>
              {form.segmentMode && (
                <div className="space-y-1.5 mb-2">
                  <label className="text-xs font-medium text-muted-foreground">Include Segments (AND)</label>
                  <p className="text-xs text-muted-foreground">User must be in ALL selected segments.</p>
                  <SegmentCheckList
                    segments={segments}
                    selected={form.segmentIncludes}
                    currentAgentTargetNames={[]}
                    onChange={(v) => update("segmentIncludes", v)}
                  />
                </div>
              )}
            </div>
            {!form.segmentMode && (
            <div>
              <label className="text-sm font-medium">Funnel Stage *</label>
              <Select
                value={form.funnelStage}
                onValueChange={(v) => update("funnelStage", v as FunnelStage)}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select a funnel stage" />
                </SelectTrigger>
                <SelectContent>
                  {FUNNEL_STAGES.map((stage) => (
                    <SelectItem key={stage} value={stage}>
                      {FUNNEL_STAGE_META[stage].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            )}
            {/* Exclude Segments — always show as optional */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Exclude Segments (optional)</label>
              <p className="text-xs text-muted-foreground">User must NOT be in any selected segment.</p>
              <SegmentCheckList
                segments={segments}
                selected={form.segmentExcludes}
                currentAgentTargetNames={[]}
                onChange={(v) => update("segmentExcludes", v)}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Target Personas</label>
              <p className="text-xs text-muted-foreground mb-2 mt-0.5">
                Same segments as <Link href="/personas" className="underline font-medium text-foreground">Personas</Link>.
                Leave empty to target all users.
              </p>
              {personas.length === 0 ? (
                <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                  <p>No personas in the database yet.</p>
                  <p className="mt-2">
                    Add them under <Link href="/personas" className="underline font-medium text-foreground">Personas</Link>
                    {" "}or run{" "}
                    <code className="text-xs bg-muted px-1.5 py-0.5 rounded">npx tsx prisma/seed-personas.ts</code>.
                  </p>
                </div>
              ) : (
                <PersonaSelector
                  personas={personas}
                  selected={form.targetPersonaIds}
                  onChange={(ids) => update("targetPersonaIds", ids)}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* Step 2: Goals */}
      {step === 2 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Conversion Goals</h2>
          <p className="text-sm text-muted-foreground">
            Define what events to optimize for and how to tier their value.
          </p>

          <div className="border rounded-lg p-4 space-y-3 bg-muted/30">
            <h3 className="text-sm font-medium">YouVersion Presets</h3>
            <GoalPresetPicker
              onSelect={(preset: YouVersionGoalPreset) => {
                const exists = form.goals.some((g) => g.eventName === preset.eventName);
                if (!exists) {
                  update("goals", [...form.goals, {
                    eventName: preset.eventName,
                    tier: preset.tier,
                    valueWeight: preset.weight,
                    weightMode: "fixed" as const,
                    weightProperty: null,
                    weightDefault: 1.0,
                  }]);
                }
              }}
            />
          </div>

          {form.goals.length > 0 && (
            <div className="space-y-2">
              {form.goals.map((g, i) => {
                const tierConf = GOAL_TIERS.find((t) => t.value === g.tier);
                const isEditing = editingGoalIdx === i;
                return (
                  <div key={i} className="border rounded-lg p-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className={cn("h-3 w-3 rounded-full shrink-0", tierConf?.color)} />
                        <div>
                          <p className="text-sm font-medium">{g.eventName}</p>
                          <p className="text-xs text-muted-foreground">
                            {tierConf?.label} ·{" "}
                            {g.weightMode === "property"
                              ? `prop: ${g.weightProperty || "—"}`
                              : `weight: ${g.valueWeight}`}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        {g.weightMode === "fixed" && (
                          <button
                            onClick={() => setEditingGoalIdx(isEditing ? null : i)}
                            className="h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                            aria-label="Edit weight"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <Button variant="ghost" size="sm" onClick={() => { removeGoal(i); setEditingGoalIdx(null); }} className="h-7 text-xs text-destructive">Remove</Button>
                      </div>
                    </div>
                    {isEditing && (
                      <div className="mt-3 pt-3 border-t">
                        <label className="text-xs text-muted-foreground">Value weight: {g.valueWeight}</label>
                        <Slider
                          min={-10} max={10} step={0.5}
                          value={[g.valueWeight]}
                          onValueChange={(v) => {
                            const updated = [...form.goals];
                            updated[i] = { ...updated[i], valueWeight: Array.isArray(v) ? v[0] : v };
                            update("goals", updated);
                          }}
                          className="mt-1"
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {form.goals.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-4">No goals added yet.</p>
          )}
        </div>
      )}

      {/* Step 3: Messages */}
      {step === 3 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Messages & Variants</h2>
          <p className="text-sm text-muted-foreground">
            Configure which channels and message variants the agent can test.
          </p>

          {totalUsers > 0 && (
            <p className="text-xs text-muted-foreground rounded-md border bg-muted/30 px-3 py-2">
              <span className="font-medium text-foreground">{formatNumber(pushPreferredCount)}</span> of{" "}
              {formatNumber(totalUsers)} tracked users prefer push as their channel (external, 90-day).
            </p>
          )}

          {/* Push channel: use the full TemplatePicker in draft mode */}
          {newMsg.channel === "push" ? (
            <div className="border rounded-lg p-4 bg-muted/30">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-medium">Add Push Message</h3>
                <Select value={newMsg.channel} onValueChange={(v) => setNewMsg((m) => ({ ...m, channel: v as Channel, variants: [{ ...emptyVariant(), name: "V1" }] }))}>
                  <SelectTrigger className="w-28 h-7 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CHANNELS.map((c) => (
                      <SelectItem key={c} value={c}>{c.toUpperCase()}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <TemplatePicker ref={templatePickerRef} onAddToDraft={addMessageFromTemplate} />
            </div>
          ) : (
            /* Email / SMS: manual variant form */
            <div className="border rounded-lg p-4 space-y-3 bg-muted/30">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">Add Message</h3>
                <Select value={newMsg.channel} onValueChange={(v) => setNewMsg((m) => ({ ...m, channel: v as Channel, variants: [{ ...emptyVariant(), name: "V1" }] }))}>
                  <SelectTrigger className="w-28 h-7 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CHANNELS.map((c) => (
                      <SelectItem key={c} value={c}>{c.toUpperCase()}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Input
                placeholder="Message name"
                value={newMsg.name}
                onChange={(e) => setNewMsg((m) => ({ ...m, name: e.target.value }))}
              />
              {newMsg.variants.map((v, vi) => (
                <div key={vi} className="space-y-2 pt-2 border-t">
                  <Input
                    placeholder="Body text"
                    value={v.body}
                    onChange={(e) => {
                      const variants = [...newMsg.variants];
                      variants[vi] = { ...v, body: e.target.value };
                      setNewMsg((m) => ({ ...m, variants }));
                    }}
                  />
                  {newMsg.channel === "email" && (
                    <Input
                      placeholder="Subject line"
                      value={v.subject}
                      onChange={(e) => {
                        const variants = [...newMsg.variants];
                        variants[vi] = { ...v, subject: e.target.value };
                        setNewMsg((m) => ({ ...m, variants }));
                      }}
                    />
                  )}
                </div>
              ))}
              <Button
                size="sm"
                variant="outline"
                onClick={() => setNewMsg((m) => ({ ...m, variants: [...m.variants, { ...emptyVariant(), name: `V${m.variants.length + 1}` }] }))}
              >
                + Add Variant
              </Button>
              <Button
                size="sm"
                onClick={addMessage}
                disabled={!newMsg.name.trim() || newMsg.variants.length === 0}
              >
                Add Message
              </Button>
            </div>
          )}

          {form.messages.map((m, i) => (
            <div key={i} className="border rounded-lg p-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">{m.name}</p>
                <p className="text-xs text-muted-foreground capitalize">{m.channel} · {m.variants.length} variant(s)</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => removeMessage(i)} className="h-7 text-xs text-destructive">Remove</Button>
            </div>
          ))}

          {/* Convergence estimate — shown once at least one message with variants is added */}
          {(() => {
            const totalArms = form.messages.reduce((sum, m) => sum + m.variants.length, 0);
            if (totalArms === 0) return null;
            const estimate = estimateConvergence(form.funnelStage, totalArms);
            const stageLabel = form.funnelStage ? (FUNNEL_STAGE_META[form.funnelStage]?.label ?? form.funnelStage) : null;
            return (
              <div className="rounded-lg border bg-muted/30 p-3 space-y-0.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">Estimated time to convergence</span>
                  <span className="text-xs font-semibold tabular-nums">{estimate}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {totalArms} arm{totalArms !== 1 ? "s" : ""}{stageLabel ? ` · ${stageLabel} eligibility` : ""}
                  {" · ~30–50 observations per arm needed"}
                </p>
              </div>
            );
          })()}
        </div>
      )}

      {/* Step 4: Scheduling */}
      {step === 4 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Scheduling & Guardrails</h2>

          <div className="space-y-4">
            <div className="border rounded-lg p-4 space-y-3">
              <h3 className="text-sm font-semibold">Frequency Cap</h3>
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <label className="text-xs text-muted-foreground">Max sends: {form.frequencyCap.maxSends}</label>
                  <Slider
                    min={1} max={14} step={1}
                    value={[form.frequencyCap.maxSends]}
                    onValueChange={(v) => update("frequencyCap", { ...form.frequencyCap, maxSends: Array.isArray(v) ? v[0] : v })}
                    className="mt-1"
                  />
                </div>
                <Select
                  value={form.frequencyCap.period}
                  onValueChange={(v) => update("frequencyCap", { ...form.frequencyCap, period: v })}
                >
                  <SelectTrigger className="w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FREQ_PERIODS.map((p) => (
                      <SelectItem key={p.value} value={p.value}>per {p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="border rounded-lg p-4 space-y-3">
              <h3 className="text-sm font-semibold">Quiet Hours</h3>
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <div>
                  <label className="text-xs text-muted-foreground">Start</label>
                  <Input
                    type="time"
                    value={form.quietStart}
                    onChange={(e) => update("quietStart", e.target.value)}
                    className="mt-1 w-full sm:w-32"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">End</label>
                  <Input
                    type="time"
                    value={form.quietEnd}
                    onChange={(e) => update("quietEnd", e.target.value)}
                    className="mt-1 w-full sm:w-32"
                  />
                </div>
                <div className="flex-1">
                  <label className="text-xs text-muted-foreground">Timezone</label>
                  <Select value={form.timezone} onValueChange={(v) => update("timezone", v)}>
                    <SelectTrigger className="mt-1">
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
            </div>

            <div className="border rounded-lg p-4 space-y-3">
              <div>
                <h3 className="text-sm font-semibold">Quiet Days</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  No sends will be made on the selected days. Applies on top of quiet hours.
                </p>
              </div>
              <div className="flex gap-2 flex-wrap">
                {DAYS_OF_WEEK.map((d) => {
                  const suppressed = form.quietDays.includes(d.value);
                  return (
                    <button
                      key={d.value}
                      type="button"
                      onClick={() => {
                        update(
                          "quietDays",
                          suppressed
                            ? form.quietDays.filter((x) => x !== d.value)
                            : [...form.quietDays, d.value],
                        );
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
              {form.quietDays.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Suppressed:{" "}
                  {form.quietDays
                    .sort((a, b) => a - b)
                    .map((d) => DAYS_OF_WEEK.find((x) => x.value === d)?.label)
                    .join(", ")}
                </p>
              )}
            </div>

            <div className="border rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold">Smart Suppression</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Only send to users above a predicted conversion threshold
                  </p>
                </div>
                <Switch
                  checked={form.smartSuppress}
                  onCheckedChange={(v) => update("smartSuppress", v)}
                />
              </div>
              {form.smartSuppress && (
                <div>
                  <label className="text-xs text-muted-foreground">
                    Threshold: {(form.suppressThresh * 100).toFixed(0)}% predicted conversion
                  </label>
                  <Slider
                    min={0.1} max={0.9} step={0.05}
                    value={[form.suppressThresh]}
                    onValueChange={(v) => update("suppressThresh", Array.isArray(v) ? v[0] : v)}
                    className="mt-1"
                  />
                </div>
              )}
            </div>

            <div className="border rounded-lg p-4 space-y-3">
              <div>
                <h3 className="text-sm font-semibold">Max Unique Users</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Lifetime ceiling on distinct users this agent will ever target. The agent stops sending once the cap is reached. Leave unlimited for ongoing campaigns.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Select
                  value={uniqueUsersPreset}
                  onValueChange={(v) => {
                    if (!v) return;
                    setUniqueUsersPreset(v);
                    if (v === "unlimited") {
                      setUniqueUsersCustom("");
                      update("uniqueUsersCap", null);
                    } else if (v !== "custom") {
                      update("uniqueUsersCap", parseInt(v, 10));
                    }
                  }}
                >
                  <SelectTrigger className="w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {UNIQUE_USERS_PRESETS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {uniqueUsersPreset === "custom" && (
                  <Input
                    type="number"
                    min={1}
                    className="w-28"
                    placeholder="e.g. 25000"
                    value={uniqueUsersCustom}
                    onChange={(e) => {
                      setUniqueUsersCustom(e.target.value);
                      const n = parseInt(e.target.value, 10);
                      update("uniqueUsersCap", !isNaN(n) && n >= 1 ? n : null);
                    }}
                  />
                )}
                {form.uniqueUsersCap !== null && (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    = {form.uniqueUsersCap.toLocaleString()} users
                  </span>
                )}
              </div>
            </div>

            <div className="border rounded-lg p-4 space-y-3">
              <div>
                <h3 className="text-sm font-semibold">Max Sends Per Day</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Total sends this agent can make per calendar day (UTC). Caps the daily send volume across all users. Leave unlimited for no daily ceiling.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Select
                  value={dailySendCapPreset}
                  onValueChange={(v) => {
                    if (!v) return;
                    setDailySendCapPreset(v);
                    if (v === "unlimited") {
                      setDailySendCapCustom("");
                      update("dailySendCap", null);
                    } else if (v !== "custom") {
                      update("dailySendCap", parseInt(v, 10));
                    }
                  }}
                >
                  <SelectTrigger className="w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DAILY_SEND_CAP_PRESETS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {dailySendCapPreset === "custom" && (
                  <Input
                    type="number"
                    min={1}
                    className="w-28"
                    placeholder="e.g. 2500"
                    value={dailySendCapCustom}
                    onChange={(e) => {
                      setDailySendCapCustom(e.target.value);
                      const n = parseInt(e.target.value, 10);
                      update("dailySendCap", !isNaN(n) && n >= 1 ? n : null);
                    }}
                  />
                )}
                {form.dailySendCap !== null && (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    = {form.dailySendCap.toLocaleString()} sends/day
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Step 5: Review */}
      {step === 5 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Review & Launch</h2>
          <div className="space-y-3">
            <div className="border rounded-lg p-4 space-y-2">
              <h3 className="text-sm font-semibold">Basic Info</h3>
              <p className="text-sm"><span className="text-muted-foreground">Name:</span> {form.name || "—"}</p>
              {form.segmentMode ? (
                <p className="text-sm">
                  <span className="text-muted-foreground">HT Segments:</span>{" "}
                  {form.segmentIncludes.length > 0 ? form.segmentIncludes.join(", ") : "—"}
                </p>
              ) : (
                <p className="text-sm"><span className="text-muted-foreground">Funnel Stage:</span> {form.funnelStage ? FUNNEL_STAGE_META[form.funnelStage as FunnelStage]?.label : "—"}</p>
              )}
              {form.segmentExcludes.length > 0 && (
                <p className="text-sm">
                  <span className="text-muted-foreground">Exclude:</span>{" "}
                  {form.segmentExcludes.join(", ")}
                </p>
              )}
              <p className="text-sm"><span className="text-muted-foreground">Algorithm:</span> {ALGORITHM_OPTIONS.find((a) => a.value === form.algorithm)?.label ?? form.algorithm}</p>
              {form.description && <p className="text-sm"><span className="text-muted-foreground">Description:</span> {form.description}</p>}
              {form.targetPersonaIds.length > 0 && (
                <div>
                  <p className="text-sm text-muted-foreground mb-1.5">Target Personas:</p>
                  <div className="flex flex-wrap gap-1">
                    {form.targetPersonaIds.map((pid) => {
                      const persona = personas.find((p) => p.id === pid);
                      return persona ? <PersonaBadge key={pid} persona={persona} /> : null;
                    })}
                  </div>
                </div>
              )}
            </div>
            <div className="border rounded-lg p-4 space-y-2">
              <h3 className="text-sm font-semibold">Goals ({form.goals.length})</h3>
              {form.goals.length === 0 ? (
                <p className="text-xs text-muted-foreground">None configured</p>
              ) : form.goals.map((g, i) => (
                <p key={i} className="text-sm">{g.eventName} <Badge variant="outline" className="text-xs ml-1">{g.tier}</Badge></p>
              ))}
            </div>
            <div className="border rounded-lg p-4 space-y-2">
              <h3 className="text-sm font-semibold">Messages ({form.messages.length})</h3>
              {form.messages.length === 0 ? (
                <p className="text-xs text-muted-foreground">None configured</p>
              ) : form.messages.map((m, i) => (
                <p key={i} className="text-sm">{m.name} <Badge variant="outline" className="text-xs ml-1 capitalize">{m.channel}</Badge></p>
              ))}
            </div>
            <div className="border rounded-lg p-4 space-y-2">
              <h3 className="text-sm font-semibold">Scheduling</h3>
              <p className="text-sm">Max {form.frequencyCap.maxSends} sends per {form.frequencyCap.period}</p>
              <p className="text-sm">Quiet: {form.quietStart}–{form.quietEnd} {form.timezone}</p>
              {form.quietDays.length > 0 && (
                <p className="text-sm">
                  <span className="text-muted-foreground">Quiet days: </span>
                  {form.quietDays
                    .sort((a, b) => a - b)
                    .map((d) => DAYS_OF_WEEK.find((x) => x.value === d)?.label)
                    .join(", ")}
                </p>
              )}
              <p className="text-sm">
                <span className="text-muted-foreground">Max unique users: </span>
                {form.uniqueUsersCap !== null ? form.uniqueUsersCap.toLocaleString() : "Unlimited"}
              </p>
              <p className="text-sm">
                <span className="text-muted-foreground">Max sends per day: </span>
                {form.dailySendCap !== null ? form.dailySendCap.toLocaleString() : "Unlimited"}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between mt-8 pt-4 border-t">
        <Button
          variant="outline"
          onClick={() => setStep((s) => Math.max(1, s - 1))}
          disabled={step === 1}
        >
          Back
        </Button>
        <div className="flex gap-2">
          {step < 5 ? (
            <Button
              onClick={goNext}
              disabled={step === 1 && (!form.name.trim() || (form.segmentMode ? form.segmentIncludes.length === 0 : !form.funnelStage))}
            >
              Next
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          ) : (
            <div className="flex flex-col items-end gap-1">
              <Button onClick={handleSubmit} disabled={saving || !form.name.trim()}>
                {saving ? "Saving..." : "Launch Agent"}
                <Rocket className="h-4 w-4 ml-1" />
              </Button>
              {submitError && <p className="text-sm text-red-500 mt-2">{submitError}</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
