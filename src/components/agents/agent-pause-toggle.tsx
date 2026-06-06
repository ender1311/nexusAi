"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";

export function AgentPauseToggle({
  agentId,
  agentName,
  sendingPaused,
  killSwitchOn = false,
}: {
  agentId: string;
  agentName: string;
  sendingPaused: boolean;
  killSwitchOn?: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function toggle() {
    const next = !sendingPaused;
    setLoading(true);
    try {
      const res = await fetch(`/api/agents/${agentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sendingPaused: next }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Failed to update sending state" }));
        throw new Error(body.error ?? "Failed to update sending state");
      }
      router.refresh();
      toast.success(next ? `"${agentName}" paused` : `"${agentName}" resumed`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update sending state");
    } finally {
      setLoading(false);
    }
  }

  if (sendingPaused) {
    return (
      <Button size="sm" variant="outline" disabled={loading} onClick={toggle}>
        <Play className="h-3.5 w-3.5 mr-1.5" />
        {loading ? "Resuming…" : "Resume"}
      </Button>
    );
  }

  return (
    <Button
      size="sm"
      variant="outline"
      disabled={loading}
      onClick={toggle}
      title={killSwitchOn ? "Kill switch is on — global send is paused" : undefined}
      className="hover:bg-amber-500/10 hover:text-amber-600 hover:border-amber-500/30"
    >
      <Pause className="h-3.5 w-3.5 mr-1.5" />
      {loading ? "Pausing…" : "Pause"}
    </Button>
  );
}
