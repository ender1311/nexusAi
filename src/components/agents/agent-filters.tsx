"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { Input } from "@/components/ui/input";
import { AgentStatusBadge } from "@/components/agents/agent-status-badge";
import { AgentStatus, FunnelStage, FUNNEL_STAGES, FUNNEL_STAGE_META } from "@/types/agent";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

const STATUS_FILTERS: Array<AgentStatus | "all"> = ["all", "active", "paused", "draft"];

interface AgentFiltersProps {
  search: string;
  status: string;
  stage: string | undefined;
}

export function AgentFilters({ search, status, stage }: AgentFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const updateParams = useCallback(
    (updates: Record<string, string | undefined>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === undefined || value === "" || (key === "status" && value === "all")) {
          params.delete(key);
        } else {
          params.set(key, value);
        }
      }
      const qs = params.toString();
      router.replace(qs ? `/agents?${qs}` : "/agents");
    },
    [router, searchParams],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search agents..."
            className="pl-8 w-full sm:w-64 h-9"
            defaultValue={search}
            onChange={(e) => updateParams({ search: e.target.value })}
          />
        </div>
        <div className="flex items-center gap-1 border rounded-lg p-1">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s}
              onClick={() => updateParams({ status: s })}
              className={cn(
                "px-3 py-1 rounded-md text-xs font-medium transition-colors",
                status === s
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted",
              )}
            >
              {s === "all" ? "All" : <AgentStatusBadge status={s} />}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className="shrink-0 text-xs text-muted-foreground font-medium">Stage:</span>
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide pb-0.5">
          {FUNNEL_STAGES.map((s: FunnelStage) => (
            <button
              key={s}
              onClick={() => updateParams({ stage: stage === s ? undefined : s })}
              className={cn(
                "shrink-0 px-3 py-1 rounded-full text-xs font-medium border transition-colors",
                stage === s
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-muted-foreground border-border hover:text-foreground hover:border-foreground",
              )}
            >
              {FUNNEL_STAGE_META[s].label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
