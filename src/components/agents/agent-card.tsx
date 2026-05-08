"use client";

import Link from "next/link";
import { useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Agent, FUNNEL_STAGE_META } from "@/types/agent";
import { AgentStatusBadge } from "./agent-status-badge";
import { formatNumber } from "@/lib/utils";
import { MessageSquare, Target, Trash2 } from "lucide-react";
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

interface AgentCardProps {
  agent: Agent;
  conversionRate?: number;
  onDelete?: (id: string) => void;
}

const algorithmLabels: Record<string, string> = {
  thompson: "Thompson Sampling",
  epsilon_greedy: "ε-Greedy",
  contextual: "Contextual Bandit",
};

export function AgentCard({ agent, conversionRate, onDelete }: AgentCardProps) {
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    try {
      await fetch(`/api/agents/${agent.id}`, { method: "DELETE" });
      onDelete?.(agent.id);
    } finally {
      setDeleting(false);
      setShowDeleteDialog(false);
    }
  }

  return (
    <>
      <div className="relative">
        <Link href={`/agents/${agent.id}`}>
          <Card className="hover:shadow-md hover:border-primary/30 transition-shadow cursor-pointer h-full">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm truncate">{agent.name}</p>
                  {agent.description && (
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{agent.description}</p>
                  )}
                  <Badge variant="secondary" className="mt-1.5 text-xs font-normal">
                    {FUNNEL_STAGE_META[agent.funnelStage]?.label ?? agent.funnelStage} · {FUNNEL_STAGE_META[agent.funnelStage]?.description ?? ""}
                  </Badge>
                </div>
                <div className="flex items-center gap-1 shrink-0">
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
              <div className="flex gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Target className="h-3 w-3" />
                  {agent._count?.goals ?? agent.goals?.length ?? 0} goals
                </span>
                <span className="flex items-center gap-1">
                  <MessageSquare className="h-3 w-3" />
                  {agent._count?.messages ?? agent.messages?.length ?? 0} messages
                </span>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">Algorithm</p>
                  <p className="text-xs font-medium">{algorithmLabels[agent.algorithm]}</p>
                </div>
                {agent._count && (
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">Decisions</p>
                    <p className="text-xs font-medium">{formatNumber(agent._count.decisions)}</p>
                  </div>
                )}
                {conversionRate !== undefined && (
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">Conv. Rate</p>
                    <p className="text-sm font-bold text-primary">{conversionRate.toFixed(1)}%</p>
                  </div>
                )}
              </div>
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
