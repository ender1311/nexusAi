"use client";

import { useState, useEffect } from "react";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Send, CheckCircle2, XCircle, Loader2, ExternalLink } from "lucide-react";
import Link from "next/link";

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

type Agent = { id: string; name: string; status: string; _count: { decisions: number } };
type SendResult = { userId: string; status: "sent" | "suppressed" | "failed"; variantName?: string; reason?: string };

export default function DemoPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string>("");
  const [userIds, setUserIds] = useState<string[]>(DEFAULT_TEST_USERS.map(u => u.id));
  const [customInput, setCustomInput] = useState("");
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState<SendResult[]>([]);

  useEffect(() => {
    fetch("/api/agents")
      .then(r => r.json())
      .then((d: Agent[] | { data: Agent[] }) => {
        const list: Agent[] = Array.isArray(d) ? d : (d as { data: Agent[] }).data ?? [];
        const active = list.filter(a => a.status === "active");
        setAgents(active);
        if (active.length > 0) setSelectedAgentId(active[0].id);
      })
      .catch(() => {});
  }, []);

  function toggleUser(id: string) {
    setUserIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  function addCustom() {
    const id = customInput.trim();
    if (id && !userIds.includes(id)) setUserIds(prev => [...prev, id]);
    setCustomInput("");
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

  const customUserIds = userIds.filter(id => !DEFAULT_TEST_USERS.map(u => u.id).includes(id));
  const sentCount = results.filter(r => r.status === "sent").length;
  const failedCount = results.filter(r => r.status !== "sent").length;

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
                agents.map(agent => (
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
                {DEFAULT_TEST_USERS.map(user => (
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
                    {customUserIds.map(id => (
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
                  onChange={e => setCustomInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && addCustom()}
                  className="text-xs h-8"
                />
                <Button size="sm" variant="outline" onClick={addCustom} className="h-8 text-xs shrink-0">Add</Button>
              </div>
            </CardContent>
          </Card>
        </div>

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
          <Link href="/demo/deep-dive" className="text-xs text-muted-foreground hover:text-foreground ml-auto flex items-center gap-1">
            Architecture docs <ExternalLink className="h-3 w-3" />
          </Link>
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
                      <Badge
                        variant={r.status === "sent" ? "default" : "secondary"}
                        className="text-xs capitalize"
                      >
                        {r.reason ?? r.status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
