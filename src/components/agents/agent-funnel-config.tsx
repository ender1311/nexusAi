"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { FunnelStage, FUNNEL_STAGES, FUNNEL_STAGE_META } from "@/types/agent";

interface AgentFunnelConfigProps {
  agentId: string;
  funnelStage: FunnelStage;
  targetFilter: Record<string, unknown> | null;
}

export function AgentFunnelConfig({ agentId, funnelStage, targetFilter }: AgentFunnelConfigProps) {
  const router = useRouter();
  const [stage, setStage] = useState<FunnelStage>(funnelStage);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await fetch(`/api/agents/${agentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ funnelStage: stage }),
      });
      setDirty(false);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="text-sm font-medium">Funnel Stage</p>
        <p className="text-xs text-muted-foreground">
          Determines which users this agent targets based on their lifecycle stage.
        </p>
        <div className="flex items-center gap-3">
          <Select
            value={stage}
            onValueChange={(value) => {
              setStage(value as FunnelStage);
              setDirty(value !== funnelStage);
            }}
          >
            <SelectTrigger className="w-72">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FUNNEL_STAGES.map((s) => (
                <SelectItem key={s} value={s}>
                  {FUNNEL_STAGE_META[s].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {dirty && (
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">Target Filter</p>
        <p className="text-xs text-muted-foreground">
          Additional attribute conditions applied after persona matching.
        </p>
        {targetFilter !== null ? (
          <pre className="rounded-md bg-muted px-4 py-3 text-xs font-mono overflow-x-auto border">
            <code>{JSON.stringify(targetFilter, null, 2)}</code>
          </pre>
        ) : (
          <p className="text-sm text-muted-foreground italic">
            No filter — all persona-matched users are eligible
          </p>
        )}
      </div>
    </div>
  );
}
