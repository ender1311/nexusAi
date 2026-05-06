"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Header } from "@/components/layout/header";
import { AgentCard } from "@/components/agents/agent-card";
import { AgentStatusBadge } from "@/components/agents/agent-status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AgentStatus, FunnelStage, FUNNEL_STAGES, FUNNEL_STAGE_META, Agent } from "@/types/agent";
import { Bot, Plus, Search } from "lucide-react";
import { cn } from "@/lib/utils";

const STATUS_FILTERS: Array<AgentStatus | "all"> = ["all", "active", "paused", "draft"];

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<AgentStatus | "all">("all");
  const [stageFilter, setStageFilter] = useState<FunnelStage | null>(null);

  useEffect(() => {
    fetch("/api/agents")
      .then((res) => res.json())
      .then((data: Agent[]) => setAgents(Array.isArray(data) ? data : []))
      .catch((err) => console.error("Failed to fetch agents:", err))
      .finally(() => setLoading(false));
  }, []);

  const filtered = agents.filter((a) => {
    const matchSearch = a.name.toLowerCase().includes(search.toLowerCase()) ||
      a.description?.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "all" || a.status === statusFilter;
    const matchStage = stageFilter === null || a.funnelStage === stageFilter;
    return matchSearch && matchStatus && matchStage;
  });

  return (
    <>
      <Header title="Agents" description="Manage your Nexus agents" />
      <div className="p-4 sm:p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search agents..."
                className="pl-8 w-full sm:w-64 h-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-1 border rounded-lg p-1">
              {STATUS_FILTERS.map((s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={cn(
                    "px-3 py-1 rounded-md text-xs font-medium transition-colors",
                    statusFilter === s
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  )}
                >
                  {s === "all" ? "All" : <AgentStatusBadge status={s} />}
                </button>
              ))}
            </div>
          </div>
          <Link href="/agents/new">
            <Button size="sm">
              <Plus className="h-4 w-4 mr-1" />
              New Agent
            </Button>
          </Link>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground font-medium">Stage:</span>
          {FUNNEL_STAGES.map((stage) => (
            <button
              key={stage}
              onClick={() => setStageFilter(stageFilter === stage ? null : stage)}
              className={cn(
                "px-3 py-1 rounded-full text-xs font-medium border transition-colors",
                stageFilter === stage
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-muted-foreground border-border hover:text-foreground hover:border-foreground"
              )}
            >
              {FUNNEL_STAGE_META[stage].label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-48 rounded-lg border bg-muted/30 animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          agents.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center border-2 border-dashed rounded-xl text-muted-foreground">
              <Bot className="h-10 w-10 mx-auto mb-3 opacity-40" />
              <p className="font-medium">No agents yet</p>
              <p className="text-sm text-muted-foreground mt-1">Create your first Nexus agent to start optimizing message performance.</p>
              <Link href="/agents/new" className="mt-4">
                <Button size="sm">
                  <Plus className="h-4 w-4 mr-1" />
                  Create Agent
                </Button>
              </Link>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-center border-2 border-dashed rounded-xl text-muted-foreground">
              <Search className="h-10 w-10 mx-auto mb-3 opacity-40" />
              <p className="font-medium">No matching agents</p>
              <p className="text-sm text-muted-foreground mt-1">Try adjusting your search or filter criteria.</p>
              <Button
                variant="ghost"
                size="sm"
                className="mt-4"
                onClick={() => { setSearch(""); setStatusFilter("all"); setStageFilter(null); }}
              >
                Clear filters
              </Button>
            </div>
          )
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
