"use client";

import { useState, useEffect } from "react";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Send, CheckCircle2, XCircle, Loader2, Users, Trash2, Download } from "lucide-react";
import type { DemoPreviewResponse, DemoAssignment } from "@/app/api/demo/preview/route";
import { OptimizationSimulation } from "@/components/demo/optimization-simulation";

// Inline checkbox — shadcn Checkbox not installed in this project
function Checkbox({ checked, onCheckedChange }: { checked: boolean; onCheckedChange: () => void }) {
  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={onCheckedChange}
      className="h-4 w-4 rounded border accent-primary cursor-pointer"
    />
  );
}

const DEFAULT_TEST_USERS = [
  { id: "183037114", label: "Dan Luk (E2E)" },
];

const USER_LABEL_MAP = new Map(DEFAULT_TEST_USERS.map((u) => [u.id, u.label]));
const GROUPS_KEY = "nexus-demo-groups";

type Group = { id: string; name: string; userIds: string[] };
type Agent = { id: string; name: string; status: string; _count: { decisions: number } };
type SendResult = { userId: string; status: "sent" | "suppressed" | "failed"; variantName?: string; reason?: string };

function loadGroups(): Group[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(GROUPS_KEY) ?? "[]");
  } catch {
    return [];
  }
}

// ── Push notification preview card ──────────────────────────────────────────

function PushPreviewCard({ assignment }: { assignment: DemoAssignment }) {
  const label = USER_LABEL_MAP.get(assignment.userId);
  return (
    <div className="rounded-lg border p-3 space-y-2.5 bg-card">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {label && <p className="text-xs font-medium truncate">{label}</p>}
          <p className="text-[10px] text-muted-foreground font-mono">{assignment.userId}</p>
        </div>
        <span
          className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium border"
          style={{ color: assignment.persona.color, borderColor: assignment.persona.color + "40", backgroundColor: assignment.persona.color + "15" }}
        >
          {assignment.persona.icon} {assignment.persona.name}
        </span>
      </div>

      {/* Push notification mockup */}
      <div className="rounded-xl bg-muted/50 border px-3 pt-2 pb-3 space-y-1">
        <div className="flex items-center gap-1.5">
          <div className="h-3.5 w-3.5 rounded-[3px] bg-primary shrink-0" />
          <span className="text-[10px] font-semibold text-muted-foreground">YouVersion Bible</span>
          <span className="text-[10px] text-muted-foreground ml-auto">now</span>
        </div>
        {assignment.variant.title && (
          <p className="text-xs font-semibold leading-snug">{assignment.variant.title}</p>
        )}
        <p className="text-xs text-muted-foreground leading-snug line-clamp-3">{assignment.variant.body}</p>
      </div>

      <p className="text-[10px] text-muted-foreground">
        Variant: <span className="font-medium text-foreground">{assignment.variant.name}</span>
      </p>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function DemoPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string>("");
  const [userIds, setUserIds] = useState<string[]>(DEFAULT_TEST_USERS.map((u) => u.id));
  const [customInput, setCustomInput] = useState("");
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState<SendResult[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupNameInput, setGroupNameInput] = useState("");
  const [preview, setPreview] = useState<DemoPreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    fetch("/api/agents")
      .then((r) => r.json())
      .then((d: Agent[] | { data: Agent[] }) => {
        const list: Agent[] = Array.isArray(d) ? d : (d as { data: Agent[] }).data ?? [];
        const active = list.filter((a) => a.status === "active");
        setAgents(active);
        if (active.length > 0) setSelectedAgentId(active[0].id);
      })
      .catch(() => {});
    setGroups(loadGroups());
  }, []);

  // Auto-fetch preview whenever agent or users change
  useEffect(() => {
    if (!selectedAgentId || userIds.length === 0) {
      setPreview(null);
      return;
    }
    const controller = new AbortController();
    const t = setTimeout(() => {
      setPreviewLoading(true);
      fetch("/api/demo/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: selectedAgentId, userIds }),
        signal: controller.signal,
      })
        .then(async (r) => {
          if (!r.ok) {
            setPreview(null);
            return;
          }
          setPreview((await r.json()) as DemoPreviewResponse);
        })
        .catch(() => {})
        .finally(() => setPreviewLoading(false));
    }, 300);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [selectedAgentId, userIds]);

  function toggleUser(id: string) {
    setUserIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function addCustom() {
    const id = customInput.trim();
    if (id && !userIds.includes(id)) setUserIds((prev) => [...prev, id]);
    setCustomInput("");
  }

  function saveGroup() {
    const name = groupNameInput.trim();
    if (!name || userIds.length === 0) return;
    const newGroup: Group = { id: Date.now().toString(36), name, userIds: [...userIds] };
    const updated = [...groups, newGroup];
    setGroups(updated);
    localStorage.setItem(GROUPS_KEY, JSON.stringify(updated));
    setGroupNameInput("");
  }

  function loadGroup(group: Group) {
    setUserIds([...group.userIds]);
  }

  function deleteGroup(id: string) {
    const updated = groups.filter((g) => g.id !== id);
    setGroups(updated);
    localStorage.setItem(GROUPS_KEY, JSON.stringify(updated));
  }

  async function handleSend() {
    if (!selectedAgentId || userIds.length === 0) return;
    setSending(true);
    setResults([]);
    try {
      const res = await fetch("/api/demo/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: selectedAgentId, userIds }),
      });
      const data: { data?: SendResult[]; error?: string } = await res.json();
      setResults(data.data ?? []);
    } finally {
      setSending(false);
    }
  }

  const customUserIds = userIds.filter((id) => !DEFAULT_TEST_USERS.map((u) => u.id).includes(id));
  const sentCount = results.filter((r) => r.status === "sent").length;
  const failedCount = results.filter((r) => r.status !== "sent").length;

  return (
    <>
      <Header title="Push Demo" description="Send test push notifications to selected users" />
      <div className="p-4 sm:p-6 space-y-6">

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Agent selector */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold">Agent</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {agents.length === 0 ? (
                <p className="text-xs text-muted-foreground py-2">No active agents found.</p>
              ) : (
                agents.map((agent) => (
                  <button
                    key={agent.id}
                    onClick={() => setSelectedAgentId(agent.id)}
                    className={`w-full flex items-center justify-between p-2.5 rounded-lg border text-left text-sm transition-colors ${
                      selectedAgentId === agent.id
                        ? "border-primary bg-primary/5 font-medium"
                        : "hover:bg-muted/50"
                    }`}
                  >
                    <span className="truncate text-xs">{agent.name}</span>
                    <span className="text-xs text-muted-foreground ml-2 shrink-0">{agent._count.decisions} sends</span>
                  </button>
                ))
              )}
            </CardContent>
          </Card>

          {/* User selector */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold">Target Users</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                {DEFAULT_TEST_USERS.map((user) => (
                  <label key={user.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 cursor-pointer">
                    <Checkbox checked={userIds.includes(user.id)} onCheckedChange={() => toggleUser(user.id)} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium">{user.label}</p>
                      <p className="text-xs text-muted-foreground font-mono">{user.id}</p>
                    </div>
                  </label>
                ))}
              </div>

              {customUserIds.length > 0 && (
                <>
                  <Separator />
                  <div className="space-y-1">
                    {customUserIds.map((id) => (
                      <div key={id} className="flex items-center justify-between px-2 py-1.5 rounded border text-xs font-mono">
                        <span className="text-muted-foreground">{id}</span>
                        <button onClick={() => toggleUser(id)} className="text-muted-foreground hover:text-destructive ml-2">✕</button>
                      </div>
                    ))}
                  </div>
                </>
              )}

              <div className="flex gap-2">
                <Input
                  placeholder="Add user ID…"
                  value={customInput}
                  onChange={(e) => setCustomInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addCustom()}
                  className="text-xs h-8"
                />
                <Button size="sm" variant="outline" onClick={addCustom} className="h-8 text-xs shrink-0">Add</Button>
              </div>

              <Separator />

              {/* Saved groups */}
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs font-medium text-muted-foreground">Saved groups</span>
                </div>

                {groups.length === 0 ? (
                  <p className="text-xs text-muted-foreground pl-5">No groups yet</p>
                ) : (
                  <div className="space-y-1">
                    {groups.map((group) => (
                      <div key={group.id} className="flex items-center justify-between px-2 py-1.5 rounded-lg border hover:bg-muted/30 transition-colors">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-xs font-medium truncate">{group.name}</span>
                          <Badge variant="outline" className="text-xs shrink-0">{group.userIds.length}</Badge>
                        </div>
                        <div className="flex items-center gap-1 ml-2 shrink-0">
                          <button onClick={() => loadGroup(group)} title="Load group" className="p-1 rounded hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors">
                            <Download className="h-3 w-3" />
                          </button>
                          <button onClick={() => deleteGroup(group.id)} title="Delete group" className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors">
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex gap-2 pt-1">
                  <Input
                    placeholder="Group name…"
                    value={groupNameInput}
                    onChange={(e) => setGroupNameInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && saveGroup()}
                    className="text-xs h-8"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={saveGroup}
                    disabled={!groupNameInput.trim() || userIds.length === 0}
                    className="h-8 text-xs shrink-0"
                  >
                    Save
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Preview */}
        {(previewLoading || (preview && preview.assignments.length > 0)) && (
          <div className="space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Preview — {preview ? preview.agentName : "…"}
            </p>
            <div className={`grid gap-3 ${userIds.length === 1 ? "grid-cols-1 max-w-sm" : "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3"}`}>
              {previewLoading
                ? userIds.map((id) => <Skeleton key={id} className="h-36 w-full rounded-lg" />)
                : preview?.assignments.map((a) => <PushPreviewCard key={a.userId} assignment={a} />)
              }
            </div>
          </div>
        )}

        {/* Send bar */}
        <div className="flex items-center gap-4 flex-wrap">
          <Button
            onClick={handleSend}
            disabled={sending || !selectedAgentId || userIds.length === 0}
            className="gap-2"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {sending ? "Sending…" : `Send to ${userIds.length} user${userIds.length === 1 ? "" : "s"}`}
          </Button>
          {results.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {sentCount} sent{failedCount > 0 ? `, ${failedCount} failed/suppressed` : ""}
            </span>
          )}
        </div>

        {/* Results */}
        {results.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold">Results</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1">
                {results.map((r, i) => (
                  <div key={i} className="flex items-center justify-between text-xs py-2 border-b last:border-0">
                    <div className="flex items-center gap-2">
                      {r.status === "sent"
                        ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                        : <XCircle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      }
                      <span className="font-mono text-muted-foreground">{r.userId}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {r.variantName && <Badge variant="outline" className="text-xs">{r.variantName}</Badge>}
                      <Badge variant={r.status === "sent" ? "default" : "secondary"} className="text-xs capitalize">
                        {r.reason ?? r.status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <Separator />

        <OptimizationSimulation />
      </div>
    </>
  );
}
