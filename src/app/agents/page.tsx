"use client";

import { useState } from "react";
import Link from "next/link";
import { Header } from "@/components/layout/header";
import { AgentCard } from "@/components/agents/agent-card";
import { AgentStatusBadge } from "@/components/agents/agent-status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { mockAgents } from "@/lib/mock/agents";
import { agentMetrics } from "@/lib/mock/metrics";
import { AgentStatus } from "@/types/agent";
import { Plus, Search } from "lucide-react";
import { cn } from "@/lib/utils";

const STATUS_FILTERS: Array<AgentStatus | "all"> = ["all", "active", "paused", "draft"];

export default function AgentsPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<AgentStatus | "all">("all");

  const filtered = mockAgents.filter((a) => {
    const matchSearch = a.name.toLowerCase().includes(search.toLowerCase()) ||
      a.description?.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "all" || a.status === statusFilter;
    return matchSearch && matchStatus;
  });

  return (
    <>
      <Header title="Agents" description="Manage your Nexus agents" />
      <div className="p-6 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search agents..."
                className="pl-8 w-64 h-9"
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

        {filtered.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <p className="text-sm">No agents found</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map((agent) => {
              const metric = agentMetrics.find((m) => m.agentId === agent.id);
              return (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  conversionRate={metric?.conversionRate}
                />
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
