"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
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
  { value: "cap", label: "Daily cap ↑" },
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
      const capA = a.dailySendCap ?? Infinity;
      const capB = b.dailySendCap ?? Infinity;
      return capA - capB;
    });
  }
  return copy;
}

function SortableAgent({
  agent,
  convergenceState,
  isCustom,
}: {
  agent: Agent;
  convergenceState?: ConvergenceState;
  isCustom: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: agent.id,
    disabled: !isCustom,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn("relative group", isDragging && "opacity-50 z-50")}
    >
      {isCustom && (
        <div
          {...attributes}
          {...listeners}
          className={cn(
            "absolute left-1 top-1/2 -translate-y-1/2 z-10 p-1 rounded",
            "text-muted-foreground/30 group-hover:text-muted-foreground/60 transition-colors",
            "opacity-0 group-hover:opacity-100",
            "cursor-grab active:cursor-grabbing touch-none",
          )}
        >
          <GripVertical className="h-4 w-4" />
        </div>
      )}
      <AgentCard
        agent={agent}
        convergenceState={convergenceState}
      />
    </div>
  );
}

export function AgentGrid({ agents: initialAgents, convergenceStates }: AgentGridProps) {
  const router = useRouter();
  const [sortMode, setSortMode] = useState<SortMode>("custom");
  const [customOrder, setCustomOrder] = useState<Agent[]>(initialAgents);

  // Activate with 8px movement to avoid accidental drags on tap; touch requires 250ms press.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
  );

  const displayed = sortMode === "custom" ? customOrder : sortAgents(initialAgents, sortMode);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = customOrder.findIndex((a) => a.id === active.id);
    const newIndex = customOrder.findIndex((a) => a.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const prev = customOrder;
    const next = arrayMove(customOrder, oldIndex, newIndex);
    setCustomOrder(next);

    fetch("/api/agents/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderedIds: next.map((a) => a.id) }),
    }).then((res) => {
      if (res.ok) {
        router.refresh();
      } else {
        setCustomOrder(prev);
      }
    }).catch(() => {
      setCustomOrder(prev);
    });
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

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext
          items={displayed.map((a) => a.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {displayed.map((agent) => (
              <SortableAgent
                key={agent.id}
                agent={agent}
                convergenceState={convergenceStates?.[agent.id]}
                isCustom={sortMode === "custom"}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}
