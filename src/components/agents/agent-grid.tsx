"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { Agent } from "@/types/agent";
import { AgentCard } from "./agent-card";

type SortMode = "custom" | "alpha" | "decisions" | "cap";

type ConvergenceState = "exploring" | "learning" | "converging" | "confident";

interface AgentGridProps {
  agents: Agent[];
  convergenceStates?: Record<string, ConvergenceState>;
}

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: "custom", label: "Custom" },
  { value: "alpha", label: "Name A–Z" },
  { value: "decisions", label: "Most Decisions" },
  { value: "cap", label: "Cap ↑" },
];

function sortAgents(agents: Agent[], mode: SortMode): Agent[] {
  if (mode === "custom") return agents;
  const copy = [...agents];
  if (mode === "alpha") {
    copy.sort((a, b) => a.name.localeCompare(b.name));
  } else if (mode === "decisions") {
    copy.sort((a, b) => (b._count?.decisions ?? 0) - (a._count?.decisions ?? 0));
  } else if (mode === "cap") {
    copy.sort((a, b) => {
      const capA = a.audienceCap ?? Infinity;
      const capB = b.audienceCap ?? Infinity;
      return capA - capB;
    });
  }
  return copy;
}

export function AgentGrid({ agents: initialAgents, convergenceStates }: AgentGridProps) {
  const router = useRouter();
  const [sortMode, setSortMode] = useState<SortMode>("custom");
  const [customOrder, setCustomOrder] = useState<Agent[]>(initialAgents);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const dragIdRef = useRef<string | null>(null);

  const displayed = sortMode === "custom" ? customOrder : sortAgents(initialAgents, sortMode);

  function handleDragStart(id: string) {
    setDragId(id);
    dragIdRef.current = id;
  }

  function handleDragOver(e: React.DragEvent, id: string) {
    e.preventDefault();
    if (dragIdRef.current !== id) {
      setDragOverId(id);
    }
  }

  function handleDragLeave() {
    setDragOverId(null);
  }

  function handleDrop(targetId: string) {
    const sourceId = dragIdRef.current;
    if (!sourceId || sourceId === targetId) {
      setDragId(null);
      setDragOverId(null);
      dragIdRef.current = null;
      return;
    }

    const next = [...customOrder];
    const fromIdx = next.findIndex((a) => a.id === sourceId);
    const toIdx = next.findIndex((a) => a.id === targetId);
    if (fromIdx === -1 || toIdx === -1) return;

    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);

    setCustomOrder(next);
    setDragId(null);
    setDragOverId(null);
    dragIdRef.current = null;

    fetch("/api/agents/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderedIds: next.map((a) => a.id) }),
    }).then((res) => {
      if (res.ok) {
        router.refresh();
      }
    });
  }

  function handleDragEnd() {
    setDragId(null);
    setDragOverId(null);
    dragIdRef.current = null;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        {SORT_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setSortMode(opt.value)}
            className={cn(
              "px-3 py-1 rounded-full text-xs font-medium transition-colors border",
              sortMode === opt.value
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-transparent text-muted-foreground border-border hover:border-foreground/30 hover:text-foreground",
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {displayed.map((agent) => (
          <div
            key={agent.id}
            className={cn("relative group", dragId === agent.id && "opacity-50")}
            draggable={sortMode === "custom"}
            onDragStart={() => handleDragStart(agent.id)}
            onDragOver={(e) => handleDragOver(e, agent.id)}
            onDragLeave={handleDragLeave}
            onDrop={() => handleDrop(agent.id)}
            onDragEnd={handleDragEnd}
          >
            {dragOverId === agent.id && dragId !== agent.id && (
              <div className="absolute top-0 left-0 right-0 h-0.5 bg-amber-400 rounded-full z-10 -translate-y-1" />
            )}
            {sortMode === "custom" && (
              <div
                className={cn(
                  "absolute left-1 top-1/2 -translate-y-1/2 z-10 p-1 rounded text-muted-foreground/30 group-hover:text-muted-foreground/60 transition-colors opacity-0 group-hover:opacity-100",
                  "cursor-grab active:cursor-grabbing",
                )}
              >
                <GripVertical className="h-4 w-4" />
              </div>
            )}
            <AgentCard
              agent={agent}
              audienceCap={agent.audienceCap}
              convergenceState={convergenceStates?.[agent.id]}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
