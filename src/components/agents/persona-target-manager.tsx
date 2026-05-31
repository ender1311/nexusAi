"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PERSONA_COLORS, PERSONA_ICON_MAP } from "@/lib/persona-display";
import { cn } from "@/lib/utils";

type LinkedPersona = {
  id: string;
  userCount?: number;
  persona: { id: string; name: string; label: string | null; icon: string; color: string };
};

type AvailablePersona = {
  id: string;
  name: string;
  label: string | null;
  icon: string;
  color: string;
};

type Props = {
  agentId: string;
  initialTargets: LinkedPersona[];
  allPersonas: AvailablePersona[];
};

export function PersonaTargetManager({ agentId, initialTargets, allPersonas }: Props) {
  const [targets, setTargets] = useState<LinkedPersona[]>(initialTargets);
  const [selectedPersonaId, setSelectedPersonaId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const linkedIds = new Set(targets.map((t) => t.persona.id));
  const unlinked = allPersonas.filter((p) => !linkedIds.has(p.id));

  async function handleAdd() {
    if (!selectedPersonaId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/agents/${agentId}/personas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personaId: selectedPersonaId }),
      });
      if (!res.ok) {
        const d = await res.json() as { error?: string };
        setError(d.error ?? "Failed to add persona");
        return;
      }
      const persona = allPersonas.find((p) => p.id === selectedPersonaId)!;
      setTargets((prev) => [
        ...prev,
        { id: selectedPersonaId, persona },
      ]);
      setSelectedPersonaId("");
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  async function handleRemove(personaId: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/agents/${agentId}/personas/${personaId}`, { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json() as { error?: string };
        setError(d.error ?? "Failed to remove persona");
        return;
      }
      setTargets((prev) => prev.filter((t) => t.persona.id !== personaId));
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Linked personas */}
      {targets.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {targets.map(({ persona, userCount }) => {
            const colors = PERSONA_COLORS[persona.color] ?? PERSONA_COLORS.blue;
            const Icon = PERSONA_ICON_MAP[persona.icon];
            return (
              <div key={persona.id} className={cn("border rounded-lg p-3 space-y-2", colors.border, colors.bg)}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className={cn("h-8 w-8 rounded-full flex items-center justify-center", colors.iconBg)}>
                      {Icon ? (
                        <Icon className={cn("h-4 w-4", colors.text)} />
                      ) : (
                        <span className={cn("text-xs font-bold", colors.text)}>
                          {persona.name.slice(0, 2).toUpperCase()}
                        </span>
                      )}
                    </div>
                    <div>
                      <p className="text-sm font-semibold">{persona.name}</p>
                      {persona.label ? (
                        <p className={cn("text-xs", colors.text)}>{persona.label}</p>
                      ) : null}
                    </div>
                  </div>
                  <button
                    onClick={() => handleRemove(persona.id)}
                    disabled={loading}
                    className="rounded-md p-1 hover:bg-black/10 transition-colors disabled:opacity-50"
                    aria-label={`Remove ${persona.name}`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                {userCount !== undefined && (
                  <p className={cn("text-xs font-medium", colors.text)}>
                    {userCount.toLocaleString()} user{userCount !== 1 ? "s" : ""}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No target personas linked.</p>
      )}

      {/* Add persona */}
      {unlinked.length > 0 && (
        <div className="flex gap-2 items-center">
          <select
            value={selectedPersonaId}
            onChange={(e) => setSelectedPersonaId(e.target.value)}
            disabled={loading}
            className="flex-1 rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50"
          >
            <option value="">Select a persona to add…</option>
            {unlinked.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <Button
            size="sm"
            onClick={handleAdd}
            disabled={loading || !selectedPersonaId}
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add
          </Button>
        </div>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
