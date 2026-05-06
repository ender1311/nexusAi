"use client";

import { useState, useCallback } from "react";
import {
  Zap,
  Users,
  Send,
  CheckCircle2,
  XCircle,
  ChevronRight,
  Bell,
  ArrowLeft,
  Loader2,
  Smartphone,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { DemoAssignment, DemoPreviewResponse } from "@/app/api/demo/preview/route";
import type { DemoSendResponse } from "@/app/api/demo/send/route";

// ─── Types ─────────────────────────────────────────────────────────────────────

type AgentSummary = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  funnelStage: string;
  goals: { eventName: string; tier: string }[];
  messages: { _count: { variants: number } }[];
};

type PersonaSummary = {
  id: string;
  name: string;
  color: string;
  icon: string;
};

type Props = {
  agents: AgentSummary[];
  personas: PersonaSummary[];
};

// ─── Color helpers ──────────────────────────────────────────────────────────────

const PERSONA_COLORS: Record<string, { bg: string; text: string; ring: string }> = {
  blue:   { bg: "bg-blue-100",   text: "text-blue-800",   ring: "ring-blue-300" },
  green:  { bg: "bg-green-100",  text: "text-green-800",  ring: "ring-green-300" },
  purple: { bg: "bg-purple-100", text: "text-purple-800", ring: "ring-purple-300" },
  orange: { bg: "bg-orange-100", text: "text-orange-800", ring: "ring-orange-300" },
  teal:   { bg: "bg-teal-100",   text: "text-teal-800",   ring: "ring-teal-300" },
  red:    { bg: "bg-red-100",    text: "text-red-800",    ring: "ring-red-300" },
  pink:   { bg: "bg-pink-100",   text: "text-pink-800",   ring: "ring-pink-300" },
  indigo: { bg: "bg-indigo-100", text: "text-indigo-800", ring: "ring-indigo-300" },
  yellow: { bg: "bg-yellow-100", text: "text-yellow-800", ring: "ring-yellow-300" },
  gray:   { bg: "bg-gray-100",   text: "text-gray-800",   ring: "ring-gray-300" },
};

function getPersonaColor(color: string) {
  return PERSONA_COLORS[color] ?? PERSONA_COLORS.blue;
}

const TIER_LABELS: Record<string, { label: string; color: string }> = {
  best:     { label: "Best",      color: "text-emerald-600" },
  very_good:{ label: "Very Good", color: "text-green-600" },
  good:     { label: "Good",      color: "text-blue-600" },
  bad:      { label: "Bad",       color: "text-orange-600" },
  very_bad: { label: "Very Bad",  color: "text-red-600" },
  worst:    { label: "Worst",     color: "text-red-800" },
};

// ─── Sub-components ─────────────────────────────────────────────────────────────

function StepIndicator({ current }: { current: number }) {
  const steps = ["Setup", "Preview", "Send", "Results"];
  return (
    <div className="flex items-center gap-2 mb-8">
      {steps.map((label, i) => {
        const step = i + 1;
        const done = step < current;
        const active = step === current;
        return (
          <div key={step} className="flex items-center gap-2">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all ${
                done
                  ? "bg-[#57a16c] text-white"
                  : active
                  ? "bg-[#57a16c] text-white ring-4 ring-[#57a16c]/20"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {done ? <CheckCircle2 className="w-4 h-4" /> : step}
            </div>
            <span
              className={`text-xs font-medium hidden sm:inline ${
                active ? "text-foreground" : "text-muted-foreground"
              }`}
            >
              {label}
            </span>
            {i < steps.length - 1 && (
              <ChevronRight className="w-3 h-3 text-muted-foreground" />
            )}
          </div>
        );
      })}
    </div>
  );
}

function PhoneNotification({
  title,
  body,
  personaColor,
}: {
  title: string | null;
  body: string;
  personaColor: string;
}) {
  const colors = getPersonaColor(personaColor);
  return (
    <div className="rounded-2xl bg-neutral-900 p-3 shadow-xl w-full">
      {/* Status bar */}
      <div className="flex justify-between items-center px-1 mb-3">
        <span className="text-neutral-400 text-[10px] font-medium">9:41 AM</span>
        <div className="flex gap-1">
          <div className="w-3 h-1.5 bg-neutral-400 rounded-sm" />
          <div className="w-1 h-1.5 bg-neutral-400 rounded-sm" />
        </div>
      </div>
      {/* Notification card */}
      <div className="rounded-xl bg-neutral-800 p-3 flex gap-2.5">
        <div
          className={`w-8 h-8 rounded-lg ${colors.bg} flex items-center justify-center shrink-0`}
        >
          <Bell className={`w-4 h-4 ${colors.text}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-1 mb-0.5">
            <span className="text-[10px] text-neutral-400 font-medium">YouVersion</span>
            <span className="text-[9px] text-neutral-500">now</span>
          </div>
          <p className="text-white text-[11px] font-semibold leading-tight mb-0.5 truncate">
            {title ? `[Name] — ${title}` : "[Name] — Today's verse"}
          </p>
          <p className="text-neutral-300 text-[10px] leading-snug line-clamp-2">{body}</p>
        </div>
      </div>
    </div>
  );
}

function UserAssignmentCard({ assignment }: { assignment: DemoAssignment }) {
  const colors = getPersonaColor(assignment.persona.color);
  const pct = Math.round(assignment.predictedReward * 100);
  const tierMeta = assignment.goal ? TIER_LABELS[assignment.goal.tier] : null;

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4 space-y-3">
        {/* User ID + persona */}
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs text-muted-foreground font-mono mb-1">User</p>
            <p className="text-sm font-semibold truncate max-w-[140px]" title={assignment.userId}>
              {assignment.userId}
            </p>
          </div>
          <Badge
            className={`${colors.bg} ${colors.text} border-0 text-xs shrink-0`}
          >
            {assignment.persona.name}
          </Badge>
        </div>

        {/* Phone mockup */}
        <PhoneNotification
          title={assignment.variant.title}
          body={assignment.variant.body}
          personaColor={assignment.persona.color}
        />

        {/* Variant name */}
        <p className="text-[11px] text-muted-foreground">
          Variant: <span className="font-medium text-foreground">{assignment.variant.name}</span>
        </p>

        {/* Goal + predicted reward */}
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-[10px] text-muted-foreground mb-0.5">Goal event</p>
            <p className="text-xs font-medium truncate max-w-[120px]">
              {assignment.goal?.eventName ?? "—"}
            </p>
            {tierMeta && (
              <p className={`text-[10px] font-medium ${tierMeta.color}`}>{tierMeta.label}</p>
            )}
          </div>
          <div className="text-right">
            <p className="text-[10px] text-muted-foreground mb-0.5">p(convert)</p>
            <p className="text-lg font-bold text-[#57a16c]">{pct}%</p>
          </div>
        </div>

        {/* Conversion bar */}
        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-[#57a16c] rounded-full transition-all"
            style={{ width: `${Math.min(pct, 100)}%` }}
          />
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Steps ──────────────────────────────────────────────────────────────────────

function SetupStep({
  agents,
  onPreview,
}: {
  agents: AgentSummary[];
  onPreview: (agentId: string, userIds: string[]) => void;
}) {
  const [agentId, setAgentId] = useState(agents[0]?.id ?? "");
  const [rawIds, setRawIds] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePreview = useCallback(async () => {
    setError(null);
    const userIds = rawIds
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    if (userIds.length === 0) {
      setError("Enter at least one user ID.");
      return;
    }
    if (userIds.length > 20) {
      setError("Maximum 20 user IDs.");
      return;
    }
    if (!agentId) {
      setError("Select an agent.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/demo/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId, userIds }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to generate preview.");
        return;
      }
      onPreview(agentId, userIds);
    } finally {
      setLoading(false);
    }
  }, [agentId, rawIds, onPreview]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold mb-1">Live Send Demo</h2>
        <p className="text-muted-foreground text-sm">
          Select an agent, enter up to 20 Braze external user IDs, and Nexus will personalize a
          push notification for each — live.
        </p>
      </div>

      <div className="space-y-4">
        {/* Agent selector */}
        <div>
          <label className="text-sm font-medium block mb-2">Sower Agent</label>
          {agents.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No agents with active push variants found. Create an agent first.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {agents.map((agent) => {
                const active = agent.id === agentId;
                const variantCount = agent.messages.reduce(
                  (sum, m) => sum + m._count.variants,
                  0
                );
                return (
                  <button
                    key={agent.id}
                    type="button"
                    onClick={() => setAgentId(agent.id)}
                    className={`text-left rounded-xl border p-4 transition-all ${
                      active
                        ? "border-[#57a16c] bg-[#57a16c]/5 ring-2 ring-[#57a16c]/30"
                        : "border-border hover:border-[#57a16c]/50"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-semibold text-sm">{agent.name}</p>
                      <Badge variant="outline" className="text-[10px] shrink-0">
                        {agent.funnelStage}
                      </Badge>
                    </div>
                    {agent.description && (
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                        {agent.description}
                      </p>
                    )}
                    <div className="flex gap-3 mt-2">
                      {agent.goals[0] && (
                        <span className="text-[11px] text-muted-foreground">
                          Goal: <strong>{agent.goals[0].eventName}</strong>
                        </span>
                      )}
                      <span className="text-[11px] text-muted-foreground">
                        {variantCount} variant{variantCount !== 1 ? "s" : ""}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* User IDs */}
        <div>
          <label className="text-sm font-medium block mb-2">
            Test User IDs{" "}
            <span className="text-muted-foreground font-normal">(one per line or comma-separated, max 20)</span>
          </label>
          <textarea
            className="w-full rounded-xl border bg-muted/30 p-3 text-sm font-mono resize-none focus:outline-none focus:ring-2 focus:ring-[#57a16c]/40"
            rows={6}
            placeholder={"183037114\n452901823\n..."  }
            value={rawIds}
            onChange={(e) => setRawIds(e.target.value)}
          />
          <p className="text-xs text-muted-foreground mt-1">
            {
              rawIds
                .split(/[\n,]+/)
                .map((s) => s.trim())
                .filter(Boolean).length
            }{" "}
            user IDs entered
          </p>
        </div>

        {error && (
          <p className="text-sm text-red-600 flex items-center gap-1.5">
            <XCircle className="w-4 h-4 shrink-0" />
            {error}
          </p>
        )}

        <Button
          onClick={handlePreview}
          disabled={loading || agents.length === 0}
          className="bg-[#57a16c] hover:bg-[#4a8f5d] text-white w-full sm:w-auto"
          size="lg"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Generating preview…
            </>
          ) : (
            <>
              <Zap className="w-4 h-4 mr-2" />
              Preview personalizations
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

function PreviewStep({
  assignments,
  agentName,
  onSend,
  onBack,
}: {
  assignments: DemoAssignment[];
  agentName: string;
  onSend: () => void;
  onBack: () => void;
}) {
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold mb-1">Personalization Preview</h2>
          <p className="text-sm text-muted-foreground">
            {assignments.length} user{assignments.length !== 1 ? "s" : ""} · Agent:{" "}
            <strong>{agentName}</strong> · Each message is personalized by persona and bandit
            selection
          </p>
        </div>
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors shrink-0"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 flex-wrap text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-full bg-[#57a16c]" />
          Best variant for persona
        </div>
        <div className="flex items-center gap-1.5">
          <Smartphone className="w-3 h-3" />
          Actual push that will be sent
        </div>
        <div className="flex items-center gap-1.5">
          <span className="font-mono">[Name]</span>
          Braze Liquid fills at delivery
        </div>
      </div>

      {/* Assignment grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {assignments.map((a) => (
          <UserAssignmentCard key={a.userId} assignment={a} />
        ))}
      </div>

      {/* Summary bar */}
      <div className="rounded-xl bg-muted/50 border p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex gap-6">
          <div>
            <p className="text-xs text-muted-foreground">Users</p>
            <p className="text-2xl font-bold">{assignments.length}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Personas used</p>
            <p className="text-2xl font-bold">
              {new Set(assignments.map((a) => a.persona.id)).size}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Avg p(convert)</p>
            <p className="text-2xl font-bold text-[#57a16c]">
              {Math.round(
                (assignments.reduce((s, a) => s + a.predictedReward, 0) / assignments.length) *
                  100
              )}
              %
            </p>
          </div>
        </div>

        <Button
          onClick={onSend}
          size="lg"
          className="bg-[#57a16c] hover:bg-[#4a8f5d] text-white px-8"
        >
          <Send className="w-4 h-4 mr-2" />
          Send {assignments.length} notification{assignments.length !== 1 ? "s" : ""}
        </Button>
      </div>
    </div>
  );
}

function SendingStep({ assignments }: { assignments: DemoAssignment[] }) {
  return (
    <div className="space-y-6 text-center py-8">
      <div className="w-16 h-16 rounded-full bg-[#57a16c]/10 flex items-center justify-center mx-auto">
        <Send className="w-8 h-8 text-[#57a16c] animate-pulse" />
      </div>
      <div>
        <h2 className="text-xl font-bold mb-2">Sending…</h2>
        <p className="text-muted-foreground text-sm">
          Delivering {assignments.length} personalized push notification
          {assignments.length !== 1 ? "s" : ""} via Braze
        </p>
      </div>
      <div className="flex flex-col gap-2 max-w-xs mx-auto">
        {assignments.map((a, i) => (
          <div
            key={a.userId}
            className="flex items-center gap-3 text-sm"
            style={{ animationDelay: `${i * 80}ms` }}
          >
            <Loader2
              className="w-4 h-4 text-[#57a16c] animate-spin shrink-0"
              style={{ animationDuration: "1s", animationDelay: `${i * 80}ms` }}
            />
            <span className="font-mono text-xs truncate">{a.userId}</span>
            <Badge className="bg-muted text-muted-foreground border-0 text-[10px] ml-auto shrink-0">
              {a.persona.name}
            </Badge>
          </div>
        ))}
      </div>
    </div>
  );
}

function ResultsStep({
  assignments,
  results,
  onReset,
}: {
  assignments: DemoAssignment[];
  results: DemoSendResponse;
  onReset: () => void;
}) {
  const resultMap = new Map(results.results.map((r) => [r.userId, r]));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold mb-1">Send Complete</h2>
          <p className="text-sm text-muted-foreground">
            {results.sent} sent · {results.errors} error
            {results.errors !== 1 ? "s" : ""}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onReset}>
          <ArrowLeft className="w-4 h-4 mr-1.5" />
          New demo
        </Button>
      </div>

      {/* Result summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-4xl font-bold text-[#57a16c]">{results.sent}</p>
            <p className="text-sm text-muted-foreground mt-1">Notifications sent</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-4xl font-bold">
              {new Set(assignments.map((a) => a.persona.id)).size}
            </p>
            <p className="text-sm text-muted-foreground mt-1">Personas targeted</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-4xl font-bold text-[#57a16c]">
              {Math.round(
                (assignments.reduce((s, a) => s + a.predictedReward, 0) / assignments.length) *
                  100
              )}
              %
            </p>
            <p className="text-sm text-muted-foreground mt-1">Avg predicted conversion</p>
          </CardContent>
        </Card>
      </div>

      {/* Per-user results */}
      <div className="space-y-2">
        {assignments.map((a) => {
          const result = resultMap.get(a.userId);
          const ok = result?.status === "sent";
          const colors = getPersonaColor(a.persona.color);
          return (
            <div
              key={a.userId}
              className="flex items-center gap-3 rounded-xl border p-3"
            >
              {ok ? (
                <CheckCircle2 className="w-5 h-5 text-[#57a16c] shrink-0" />
              ) : (
                <XCircle className="w-5 h-5 text-red-500 shrink-0" />
              )}
              <span className="font-mono text-sm truncate flex-1">{a.userId}</span>
              <Badge className={`${colors.bg} ${colors.text} border-0 text-[10px] shrink-0`}>
                {a.persona.name}
              </Badge>
              <span className="text-xs text-muted-foreground shrink-0 hidden sm:inline truncate max-w-[140px]">
                {a.variant.title ?? a.variant.body.slice(0, 40)}
              </span>
              {!ok && result?.error && (
                <span className="text-xs text-red-600 shrink-0">{result.error}</span>
              )}
            </div>
          );
        })}
      </div>

      {/* Liquid note */}
      <Card className="border-dashed">
        <CardContent className="pt-4 pb-4">
          <p className="text-xs text-muted-foreground leading-relaxed">
            <strong className="text-foreground">Liquid personalization</strong> — each notification
            title was sent with{" "}
            <code className="bg-muted px-1 py-0.5 rounded text-[11px]">
              {`{% if \${first_name} == blank %}Hi there{% else %}{{ \${first_name} | default: '' }}{% endif %}`}
            </code>
            . Braze resolves this at delivery time using each user&apos;s stored profile.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Main wizard ────────────────────────────────────────────────────────────────

export function LiveDemoWizard({ agents }: Props) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [agentId, setAgentId] = useState<string>("");
  const [assignments, setAssignments] = useState<DemoAssignment[]>([]);
  const [agentName, setAgentName] = useState<string>("");
  const [sendResults, setSendResults] = useState<DemoSendResponse | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  const handlePreview = useCallback(
    async (selectedAgentId: string, userIds: string[]) => {
      const res = await fetch("/api/demo/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: selectedAgentId, userIds }),
      });
      const data: DemoPreviewResponse = await res.json();
      if (!res.ok) throw new Error((data as unknown as { error: string }).error);
      setAgentId(selectedAgentId);
      setAgentName(data.agentName);
      setAssignments(data.assignments);
      setStep(2);
    },
    []
  );

  const handleSetupPreview = useCallback(
    async (selectedAgentId: string, userIds: string[]) => {
      await handlePreview(selectedAgentId, userIds);
    },
    [handlePreview]
  );

  const handleSend = useCallback(async () => {
    setSendError(null);
    setStep(3);
    try {
      const res = await fetch("/api/demo/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId, assignments }),
      });
      const data: DemoSendResponse = await res.json();
      if (!res.ok) {
        setSendError((data as unknown as { error: string }).error ?? "Send failed");
        setStep(2);
        return;
      }
      setSendResults(data);
      setStep(4);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Send failed");
      setStep(2);
    }
  }, [agentId, assignments]);

  const handleReset = useCallback(() => {
    setStep(1);
    setAssignments([]);
    setSendResults(null);
    setSendError(null);
    setAgentId("");
    setAgentName("");
  }, []);

  return (
    <div className="space-y-2">
      {/* Page header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-full bg-[#57a16c] flex items-center justify-center">
          <Users className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Live Send Demo</h1>
          <p className="text-muted-foreground text-sm">
            Persona-aware bandit selection · Liquid personalization · Real Braze sends
          </p>
        </div>
      </div>

      <StepIndicator current={step} />

      {sendError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 flex items-center gap-2 mb-4">
          <XCircle className="w-4 h-4 shrink-0" />
          {sendError}
        </div>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base text-muted-foreground font-medium">
            {step === 1 && "Step 1 — Configure your test group"}
            {step === 2 && "Step 2 — Review personalizations"}
            {step === 3 && "Step 3 — Sending via Braze"}
            {step === 4 && "Step 4 — Results"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {step === 1 && (
            <SetupStep
              agents={agents}
              onPreview={handleSetupPreview}
            />
          )}
          {step === 2 && (
            <PreviewStep
              assignments={assignments}
              agentName={agentName}
              onSend={handleSend}
              onBack={() => setStep(1)}
            />
          )}
          {step === 3 && <SendingStep assignments={assignments} />}
          {step === 4 && sendResults && (
            <ResultsStep
              assignments={assignments}
              results={sendResults}
              onReset={handleReset}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
