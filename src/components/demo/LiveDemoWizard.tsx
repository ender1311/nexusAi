"use client";

import { useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Zap,
  Users,
  Send,
  CheckCircle2,
  XCircle,
  ChevronRight,
  ArrowLeft,
  Loader2,
  Smartphone,
  BookmarkPlus,
  X as XIcon,
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
  blue:   { bg: "bg-blue-100 dark:bg-blue-900/30",    text: "text-blue-800 dark:text-blue-300",    ring: "ring-blue-300 dark:ring-blue-700" },
  green:  { bg: "bg-green-100 dark:bg-green-900/30",   text: "text-green-800 dark:text-green-300",   ring: "ring-green-300 dark:ring-green-700" },
  purple: { bg: "bg-purple-100 dark:bg-purple-900/30", text: "text-purple-800 dark:text-purple-300", ring: "ring-purple-300 dark:ring-purple-700" },
  orange: { bg: "bg-orange-100 dark:bg-orange-900/30", text: "text-orange-800 dark:text-orange-300", ring: "ring-orange-300 dark:ring-orange-700" },
  teal:   { bg: "bg-teal-100 dark:bg-teal-900/30",    text: "text-teal-800 dark:text-teal-300",    ring: "ring-teal-300 dark:ring-teal-700" },
  red:    { bg: "bg-red-100 dark:bg-red-900/30",      text: "text-red-800 dark:text-red-300",      ring: "ring-red-300 dark:ring-red-700" },
  pink:   { bg: "bg-pink-100 dark:bg-pink-900/30",    text: "text-pink-800 dark:text-pink-300",    ring: "ring-pink-300 dark:ring-pink-700" },
  indigo: { bg: "bg-indigo-100 dark:bg-indigo-900/30", text: "text-indigo-800 dark:text-indigo-300", ring: "ring-indigo-300 dark:ring-indigo-700" },
  yellow: { bg: "bg-yellow-100 dark:bg-yellow-900/30", text: "text-yellow-800 dark:text-yellow-300", ring: "ring-yellow-300 dark:ring-yellow-700" },
  gray:   { bg: "bg-gray-100 dark:bg-gray-800",        text: "text-gray-800 dark:text-gray-300",    ring: "ring-gray-300 dark:ring-gray-600" },
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

function BibleAppIcon() {
  return (
    <svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
      <rect width="36" height="36" rx="7" fill="#1B3A5C" />
      <path d="M18 9C14.5 9 10.5 10.2 10.5 10.2L10.5 26.2C10.5 26.2 14.5 25 18 25C21.5 25 25.5 26.2 25.5 26.2L25.5 10.2C25.5 10.2 21.5 9 18 9Z" fill="white" />
      <line x1="18" y1="9" x2="18" y2="25" stroke="#1B3A5C" strokeWidth="1.2" />
      <line x1="12" y1="14" x2="17" y2="13.4" stroke="#1B3A5C" strokeWidth="0.75" strokeOpacity="0.35" />
      <line x1="12" y1="17.5" x2="17" y2="16.9" stroke="#1B3A5C" strokeWidth="0.75" strokeOpacity="0.35" />
      <line x1="12" y1="21" x2="17" y2="20.4" stroke="#1B3A5C" strokeWidth="0.75" strokeOpacity="0.35" />
      <line x1="24" y1="14" x2="19" y2="13.4" stroke="#1B3A5C" strokeWidth="0.75" strokeOpacity="0.35" />
      <line x1="24" y1="17.5" x2="19" y2="16.9" stroke="#1B3A5C" strokeWidth="0.75" strokeOpacity="0.35" />
      <line x1="24" y1="21" x2="19" y2="20.4" stroke="#1B3A5C" strokeWidth="0.75" strokeOpacity="0.35" />
    </svg>
  );
}

function PhoneNotification({ title, body }: { title: string | null; body: string }) {
  return (
    <div className="rounded-2xl bg-gray-100 p-3 shadow-sm w-full border border-gray-200">
      {/* Phone chrome intentionally stays light — represents a real device frame */}
      {/* Status bar */}
      <div className="flex justify-between items-center px-1 mb-3">
        <span className="text-gray-500 text-[10px] font-medium">9:41 AM</span>
        <div className="flex gap-1">
          <div className="w-3 h-1.5 bg-gray-400 rounded-sm" />
          <div className="w-1 h-1.5 bg-gray-400 rounded-sm" />
        </div>
      </div>
      {/* Notification card */}
      <div className="rounded-xl bg-white/90 p-3 flex gap-2.5 shadow-sm">
        <div className="w-8 h-8 rounded-lg shrink-0 overflow-hidden">
          <BibleAppIcon />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-1 mb-0.5">
            <span className="text-[10px] text-gray-500 font-semibold">YouVersion</span>
            <span className="text-[9px] text-gray-400">now</span>
          </div>
          <p className="text-gray-900 text-[11px] font-semibold leading-tight mb-0.5 truncate">
            {title ? `[Name] — ${title}` : "[Name] — Today's verse"}
          </p>
          <p className="text-gray-600 text-[10px] leading-snug line-clamp-2">{body}</p>
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

const GROUPS_KEY = "nexus_demo_user_groups";

type SavedGroup = { name: string; ids: string[] };

function readGroups(): SavedGroup[] {
  try {
    const stored = localStorage.getItem(GROUPS_KEY);
    return stored ? (JSON.parse(stored) as SavedGroup[]) : [];
  } catch {
    return [];
  }
}

function useSavedGroups() {
  const [groups, setGroups] = useState<SavedGroup[]>(() => {
    if (typeof window === "undefined") return [];
    return readGroups();
  });

  const save = useCallback((name: string, ids: string[]) => {
    setGroups((prev) => {
      const next = [{ name, ids }, ...prev.filter((g) => g.name !== name)].slice(0, 10);
      localStorage.setItem(GROUPS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const remove = useCallback((name: string) => {
    setGroups((prev) => {
      const next = prev.filter((g) => g.name !== name);
      localStorage.setItem(GROUPS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  return { groups, save, remove };
}

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
  const { groups, save: saveGroup, remove: removeGroup } = useSavedGroups();
  const [savingGroup, setSavingGroup] = useState(false);
  const [groupName, setGroupName] = useState("");
  const groupNameRef = useRef<HTMLInputElement>(null);

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
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <label className="text-sm font-medium">
              Test User IDs{" "}
              <span className="text-muted-foreground font-normal">(one per line or comma-separated, max 20)</span>
            </label>
            {/* Save group button */}
            {!savingGroup ? (
              <button
                type="button"
                onClick={() => {
                  setSavingGroup(true);
                  setTimeout(() => groupNameRef.current?.focus(), 0);
                }}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0"
              >
                <BookmarkPlus className="w-3.5 h-3.5" />
                Save group
              </button>
            ) : (
              <div className="flex items-center gap-1.5 shrink-0">
                <input
                  ref={groupNameRef}
                  type="text"
                  placeholder="Group name…"
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && groupName.trim()) {
                      const ids = rawIds.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
                      if (ids.length) { saveGroup(groupName.trim(), ids); setGroupName(""); setSavingGroup(false); }
                    }
                    if (e.key === "Escape") { setSavingGroup(false); setGroupName(""); }
                  }}
                  className="text-xs border rounded-lg px-2 py-1 w-32 focus:outline-none focus:ring-2 focus:ring-[#57a16c]/40 bg-background"
                />
                <button
                  type="button"
                  onClick={() => {
                    const ids = rawIds.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
                    if (ids.length && groupName.trim()) { saveGroup(groupName.trim(), ids); setGroupName(""); setSavingGroup(false); }
                  }}
                  className="text-xs bg-[#57a16c] text-white rounded-lg px-2 py-1 hover:bg-[#4a8f5d]"
                >
                  Save
                </button>
                <button type="button" onClick={() => { setSavingGroup(false); setGroupName(""); }} className="text-muted-foreground hover:text-foreground">
                  <XIcon className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>

          {/* Saved groups chips */}
          {groups.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {groups.map((g) => (
                <div key={g.name} className="flex items-center gap-1 rounded-full border bg-muted/40 pl-2.5 pr-1 py-0.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setRawIds(g.ids.join("\n"))}
                    className="font-medium hover:text-[#57a16c] transition-colors"
                  >
                    {g.name}
                    <span className="text-muted-foreground ml-1 font-normal">({g.ids.length})</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => removeGroup(g.name)}
                    className="text-muted-foreground hover:text-destructive ml-0.5"
                    aria-label={`Remove ${g.name}`}
                  >
                    <XIcon className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <textarea
            className="w-full rounded-xl border bg-muted/30 p-3 text-sm font-mono resize-none focus:outline-none focus:ring-2 focus:ring-[#57a16c]/40"
            rows={6}
            placeholder={"183037114\n452901823\n..."}
            value={rawIds}
            onChange={(e) => setRawIds(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            {rawIds.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean).length} user IDs entered
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
            <strong className="text-foreground">Liquid personalization</strong> — each title was prefixed with{" "}
            <code className="bg-muted px-1 py-0.5 rounded text-[11px]">
              {`{{${"{first_name}"}}}, `}
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
  const router = useRouter();

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
      router.replace(`?agent=${selectedAgentId}`, { scroll: false });
      setAgentName(data.agentName);
      setAssignments(data.assignments);
      setStep(2);
    },
    [router]
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
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 flex items-center gap-2 mb-4 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400">
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
