"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Check, ChevronRight, Bot, Target, MessageSquare, Calendar, Rocket } from "lucide-react";
import { GoalTier, Channel, FrequencyCap, FunnelStage, FUNNEL_STAGES, FUNNEL_STAGE_META } from "@/types/agent";
import type { VariantWithMessage } from "@/types/agent";
import type { Persona } from "@/types/persona";
import { PersonaSelector } from "@/components/personas/persona-selector";
import { PersonaBadge } from "@/components/personas/persona-badge";
import { GoalPresetPicker } from "@/components/agents/goal-preset-picker";
import { PushVariantPicker } from "@/components/agents/push-variant-picker";
import { YouVersionGoalPreset } from "@/lib/constants/youversion";

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

interface GoalDraft {
  eventName: string;
  tier: GoalTier;
  valueWeight: number;
  weightMode: "fixed" | "property";
  weightProperty?: string | null;
  weightDefault: number;
}

interface MessageDraft {
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


interface FormData {
  name: string;
  description: string;
  algorithm: string;
  epsilon: number;
  funnelStage: FunnelStage | "";
  targetPersonaIds: string[];
  goals: GoalDraft[];
  messages: MessageDraft[];
  frequencyCap: { maxSends: number; period: string };
  quietStart: string;
  quietEnd: string;
  timezone: string;
  smartSuppress: boolean;
  suppressThresh: number;
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
  smartSuppress: false,
  suppressThresh: 0.5,
};

export function AgentWizard({ personas }: { personas: Persona[] }) {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<FormData>(defaultForm);
  const [newGoal, setNewGoal] = useState<GoalDraft>({ eventName: "", tier: "best", valueWeight: 10, weightMode: "fixed", weightProperty: null, weightDefault: 1.0 });
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
  // For push channel: selected DB variant options (id, title, body, deeplink, etc.)
  const [selectedPushVariants, setSelectedPushVariants] = useState<VariantWithMessage[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const update = (key: keyof FormData, value: unknown) => setForm((f) => ({ ...f, [key]: value }));

  const addGoal = () => {
    if (!newGoal.eventName.trim()) return;
    update("goals", [...form.goals, { ...newGoal }]);
    setNewGoal({ eventName: "", tier: "best", valueWeight: 10, weightMode: "fixed", weightProperty: null, weightDefault: 1.0 });
  };

  const removeGoal = (i: number) => update("goals", form.goals.filter((_, idx) => idx !== i));

  const addMessage = () => {
    if (!newMsg.name.trim()) return;
    const variantsToSave = newMsg.channel === "push"
      ? selectedPushVariants.map((v) => ({
          ...emptyVariant(),
          name: v.name,
          title: v.title ?? "",
          body: v.body,
          deeplink: v.deeplink ?? "",
          cta: v.cta ?? "",
          sourceTemplateId: v.id,   // v.id is the template variant's id — the clone relationship
        }))
      : newMsg.variants;
    if (variantsToSave.length === 0) return;
    update("messages", [...form.messages, { ...newMsg, variants: variantsToSave }]);
    setNewMsg({ name: "", channel: "push", variants: [{ ...emptyVariant(), name: "V1" }] });
    setSelectedPushVariants([]);
    setSelectedCategory("");
  };

  const removeMessage = (i: number) => update("messages", form.messages.filter((_, idx) => idx !== i));

  const handleSubmit = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        const agent = await res.json();
        router.push(`/agents/${agent.id}`);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
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
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="thompson">Thompson Sampling (recommended)</SelectItem>
                  <SelectItem value="epsilon_greedy">Epsilon-Greedy</SelectItem>
                  <SelectItem value="contextual">Contextual Bandit</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                Thompson Sampling naturally balances exploration and delivery via Beta distributions.
              </p>
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
                      {FUNNEL_STAGE_META[stage].label} — {FUNNEL_STAGE_META[stage].description}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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

          <div className="border rounded-lg p-4 space-y-3 bg-muted/30">
            <h3 className="text-sm font-medium">Add Custom Goal</h3>
            <div className="flex gap-2">
              <Input
                placeholder="Event name (e.g. plan_started)"
                value={newGoal.eventName}
                onChange={(e) => setNewGoal((g) => ({ ...g, eventName: e.target.value }))}
                className="flex-1"
              />
              <Select value={newGoal.tier} onValueChange={(v) => {
                const tier = v as GoalTier;
                const defaultWeight = GOAL_TIERS.find((t) => t.value === tier)?.weight ?? 5;
                setNewGoal((g) => ({ ...g, tier, valueWeight: defaultWeight }));
              }}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GOAL_TIERS.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      <div className="flex items-center gap-2">
                        <div className={cn("h-2 w-2 rounded-full", t.color)} />
                        {t.label}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" onClick={addGoal} disabled={!newGoal.eventName.trim()}>Add</Button>
            </div>
            {/* Weight mode toggle */}
            <div>
              <label className="text-xs font-medium text-muted-foreground">Weight Mode</label>
              <div className="flex gap-2 mt-1.5">
                {(["fixed", "property"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setNewGoal((g) => ({ ...g, weightMode: mode }))}
                    className={cn(
                      "px-3 py-1.5 text-xs rounded-md border font-medium transition-colors",
                      newGoal.weightMode === mode
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background border-input text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {mode === "fixed" ? "Fixed Value" : "Event Property"}
                  </button>
                ))}
              </div>
            </div>

            {newGoal.weightMode === "fixed" ? (
              <div>
                <label className="text-xs text-muted-foreground">Value weight: {newGoal.valueWeight}</label>
                <Slider
                  min={-10} max={10} step={0.5}
                  value={[newGoal.valueWeight]}
                  onValueChange={(v) => setNewGoal((g) => ({ ...g, valueWeight: Array.isArray(v) ? v[0] : v }))}
                  className="mt-1"
                />
              </div>
            ) : (
              <div className="space-y-2">
                <div>
                  <label className="text-xs text-muted-foreground">Property key (e.g. order_value)</label>
                  <Input
                    placeholder="event property name"
                    value={newGoal.weightProperty ?? ""}
                    onChange={(e) => setNewGoal((g) => ({ ...g, weightProperty: e.target.value || null }))}
                    className="mt-1"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Default (when property missing): {newGoal.weightDefault}</label>
                  <Slider
                    min={0.1} max={10} step={0.1}
                    value={[newGoal.weightDefault]}
                    onValueChange={(v) => setNewGoal((g) => ({ ...g, weightDefault: Array.isArray(v) ? v[0] : v }))}
                    className="mt-1"
                  />
                </div>
              </div>
            )}
          </div>

          {form.goals.length > 0 && (
            <div className="space-y-2">
              {form.goals.map((g, i) => {
                const tierConf = GOAL_TIERS.find((t) => t.value === g.tier);
                return (
                  <div key={i} className="flex items-center justify-between p-3 border rounded-lg">
                    <div className="flex items-center gap-3">
                      <div className={cn("h-3 w-3 rounded-full", tierConf?.color)} />
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
                    <Button variant="ghost" size="sm" onClick={() => removeGoal(i)} className="h-7 text-xs text-destructive">Remove</Button>
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

          <div className="border rounded-lg p-4 space-y-3 bg-muted/30">
            <h3 className="text-sm font-medium">Add Message</h3>
            <div className="flex gap-2">
              <Input
                placeholder="Message name"
                value={newMsg.name}
                onChange={(e) => setNewMsg((m) => ({ ...m, name: e.target.value }))}
                className="flex-1"
              />
              <Select value={newMsg.channel} onValueChange={(v) => {
                setNewMsg((m) => ({ ...m, channel: v as Channel }));
                setSelectedPushVariants([]);
                setSelectedCategory("");
              }}>
                <SelectTrigger className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CHANNELS.map((c) => (
                    <SelectItem key={c} value={c}>{c.toUpperCase()}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {newMsg.channel === "push" ? (
              <div className="pt-2 border-t space-y-3">
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">Destination</p>
                  <div className="flex gap-2 flex-wrap">
                    {(["bible-verse", "guided-scripture", "plans", "general"] as const).map((cat) => {
                      const labels: Record<string, string> = {
                        "bible-verse": "Bible Verse",
                        "guided-scripture": "Guided Scripture",
                        "plans": "Plans",
                        "general": "General",
                      };
                      return (
                        <button
                          key={cat}
                          type="button"
                          onClick={() => {
                            setSelectedCategory(cat);
                            setSelectedPushVariants([]);
                          }}
                          className={cn(
                            "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                            selectedCategory === cat
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border bg-background hover:border-primary/50"
                          )}
                        >
                          {labels[cat]}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">Select approved push variants</p>
                  <PushVariantPicker
                    selectedVariantIds={selectedPushVariants.map((v) => v.id)}
                    category={selectedCategory || undefined}
                    onToggle={(v) => {
                      setSelectedPushVariants((prev) => {
                        const exists = prev.some((p) => p.id === v.id);
                        return exists ? prev.filter((p) => p.id !== v.id) : [...prev, v];
                      });
                    }}
                  />
                  {selectedPushVariants.length > 0 && (
                    <p className="text-xs text-green-700 font-medium">
                      {selectedPushVariants.length} variant(s) selected
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <>
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
              </>
            )}
            <Button
              size="sm"
              onClick={addMessage}
              disabled={!newMsg.name.trim() || (newMsg.channel === "push" ? selectedPushVariants.length === 0 : newMsg.variants.length === 0)}
            >
              Add Message
            </Button>
          </div>

          {form.messages.map((m, i) => (
            <div key={i} className="border rounded-lg p-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">{m.name}</p>
                <p className="text-xs text-muted-foreground capitalize">{m.channel} · {m.variants.length} variant(s)</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => removeMessage(i)} className="h-7 text-xs text-destructive">Remove</Button>
            </div>
          ))}
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
              <p className="text-sm"><span className="text-muted-foreground">Funnel Stage:</span> {form.funnelStage ? FUNNEL_STAGE_META[form.funnelStage].label : "—"}</p>
              <p className="text-sm"><span className="text-muted-foreground">Algorithm:</span> {form.algorithm}</p>
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
              onClick={() => setStep((s) => Math.min(5, s + 1))}
              disabled={step === 1 && (!form.name.trim() || !form.funnelStage)}
            >
              Next
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          ) : (
            <Button onClick={handleSubmit} disabled={saving || !form.name.trim()}>
              {saving ? "Saving..." : "Launch Agent"}
              <Rocket className="h-4 w-4 ml-1" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
