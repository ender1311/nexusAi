"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Agent, FUNNEL_STAGE_META } from "@/types/agent";
import { AgentStatusBadge } from "./agent-status-badge";
import { cn, formatNumber } from "@/lib/utils";
import { Bot, MessageSquare, Target, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { InfoTip } from "@/components/ui/info-tip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type ConvergenceState = "exploring" | "learning" | "converging" | "confident";

function UniqueUsersCapCell({ uniqueUsers, uniqueUsersCap }: {
  uniqueUsers: number;
  uniqueUsersCap: number | null | undefined;
}) {
  const pct = uniqueUsersCap && uniqueUsersCap > 0 ? Math.min(100, Math.round((uniqueUsers / uniqueUsersCap) * 100)) : null;

  return (
    <div className="text-right min-w-0">
      <p className="text-xs text-muted-foreground">Unique users</p>
      <div className="flex items-center justify-end gap-1 mt-0.5">
        <span className="text-xs font-medium tabular-nums">{formatNumber(uniqueUsers)}</span>
        {uniqueUsersCap != null && (
          <span className="text-xs text-muted-foreground tabular-nums">
            / {formatNumber(uniqueUsersCap)}{pct !== null ? ` (${pct}%)` : ""}
          </span>
        )}
      </div>
    </div>
  );
}

const CONVERGENCE_CONFIG: Record<ConvergenceState, { label: string; dotClass: string; textClass: string }> = {
  exploring:  { label: "Exploring",  dotClass: "bg-blue-500",   textClass: "text-blue-600 dark:text-blue-400" },
  learning:   { label: "Learning",   dotClass: "bg-amber-500",  textClass: "text-amber-600 dark:text-amber-400" },
  converging: { label: "Converging", dotClass: "bg-green-500",  textClass: "text-green-600 dark:text-green-400" },
  confident:  { label: "Confident",  dotClass: "bg-emerald-600",textClass: "text-emerald-700 dark:text-emerald-400" },
};

interface AgentCardProps {
  agent: Agent;
  conversionRate?: number;
  convergenceState?: ConvergenceState;
  onDelete?: (id: string) => void;
}

const algorithmLabels: Record<string, string> = {
  thompson: "Thompson Sampling",
  epsilon_greedy: "ε-Greedy",
  contextual: "Contextual Bandit",
  linucb: "LinUCB",
};

export function AgentCard({ agent, conversionRate, convergenceState, onDelete }: AgentCardProps) {
  const router = useRouter();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/agents/${agent.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Failed to delete agent" }));
        throw new Error(body.error ?? "Failed to delete agent");
      }
      setShowDeleteDialog(false);
      onDelete?.(agent.id);
      router.refresh();
      toast.success(`Agent "${agent.name}" deleted`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete agent");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <div className="relative h-full">
        <Link href={`/agents/${agent.id}`} className="block h-full">
          <Card className="hover:shadow-md hover:border-primary/30 transition-shadow cursor-pointer h-full">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2.5 flex-1 min-w-0">
                  <div
                    className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
                    style={{ backgroundColor: `${agent.color}20` }}
                  >
                    <Bot className="h-4 w-4" style={{ color: agent.color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm truncate">{agent.name}</p>
                    {agent.description && (
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{agent.description}</p>
                    )}
                    <Badge variant="secondary" className="mt-1.5 text-xs font-normal max-w-full truncate block">
                      {agent.targetSegmentName
                        ? `Segment: ${agent.targetSegmentName}`
                        : (FUNNEL_STAGE_META[agent.funnelStage]?.label ?? agent.funnelStage)}
                    </Badge>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
                  {convergenceState && (() => {
                    const cfg = CONVERGENCE_CONFIG[convergenceState];
                    return (
                      <span className={cn("flex items-center gap-1 text-xs font-medium", cfg.textClass)}>
                        <span className={cn("h-1.5 w-1.5 rounded-full inline-block", cfg.dotClass)} />
                        {cfg.label}
                      </span>
                    );
                  })()}
                  <AgentStatusBadge status={agent.status} />
                  <button
                    className="h-6 w-6 flex items-center justify-center rounded-md text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 transition-colors"
                    aria-label="Delete agent"
                    onClick={(e: React.MouseEvent) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setShowDeleteDialog(true);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-0 space-y-3">
              {/* Counts row */}
              <div className="flex gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Target className="h-3 w-3" />
                  {agent._count?.goals ?? agent.goals?.length ?? 0} goals
                </span>
                <span className="flex items-center gap-1">
                  <MessageSquare className="h-3 w-3" />
                  {agent._count?.variants ?? agent.messages?.reduce((s, m) => s + (m.variants?.length ?? 0), 0) ?? 0} variants
                </span>
              </div>

              {/* Stats grid — 2×2 so nothing wraps on narrow screens */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                {/* Algorithm */}
                <div>
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    Algorithm
                    <span onClick={(e) => e.stopPropagation()}>
                      <InfoTip title="Bandit Algorithm" side="top">
                        <p><strong>Thompson Sampling</strong> — Explores variants by sampling from learned Beta distributions. Self-balances exploration vs. exploitation. Best default choice.</p>
                        <p className="mt-1"><strong>ε-Greedy</strong> — Exploits the current best variant most of the time, randomly tries others ε% of runs. Simple but less adaptive to drift.</p>
                        <p className="mt-1"><strong>LinUCB (Contextual)</strong> — Uses a 10-dimensional user feature vector (engagement patterns, giving tier, recency) to find variants that work best for specific user profiles. Most powerful, needs more data to converge.</p>
                      </InfoTip>
                    </span>
                  </p>
                  <p className="text-xs font-medium">{algorithmLabels[agent.algorithm] ?? agent.algorithm}</p>
                </div>

                {/* Decisions */}
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Decisions</p>
                  <p className="text-xs font-medium tabular-nums">
                    {agent._count ? formatNumber(agent._count.decisions) : "—"}
                  </p>
                </div>

                {/* Daily sends cap */}
                <div>
                  <p className="text-xs text-muted-foreground">Daily cap</p>
                  <p className="text-xs font-medium tabular-nums">
                    {agent.dailySendCap != null ? formatNumber(agent.dailySendCap) : "—"}
                  </p>
                </div>

                {/* Unique users / cap */}
                <UniqueUsersCapCell
                  uniqueUsers={agent.uniqueUsers ?? 0}
                  uniqueUsersCap={agent.uniqueUsersCap}
                />
              </div>

              {(conversionRate !== undefined || agent.pushOpenRate != null) && (
                <div className="pt-1 border-t space-y-1">
                  {conversionRate !== undefined && (
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-muted-foreground">Conv. Rate</p>
                      <p className="text-sm font-bold text-primary">{conversionRate.toFixed(1)}%</p>
                    </div>
                  )}
                  {agent.pushOpenRate != null && (
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-muted-foreground">Push Open Rate</p>
                      <span className="flex items-baseline gap-1.5">
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {formatNumber(agent.pushOpens ?? 0)}/{formatNumber(agent.pushSends ?? 0)}
                        </span>
                        <span className="text-sm font-bold text-primary tabular-nums">
                          {agent.pushOpenRate.toFixed(1)}%
                        </span>
                      </span>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </Link>
      </div>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete agent?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{agent.name}</strong> and all its goals, messages, variants, decisions,
              and arm stats will be permanently deleted. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Deleting…" : "Delete Agent"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
