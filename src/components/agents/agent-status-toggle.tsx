"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";

export function AgentStatusToggle({
  agentId,
  status,
}: {
  agentId: string;
  status: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const isActive = status === "active";

  async function toggle() {
    setLoading(true);
    try {
      await fetch(`/api/agents/${agentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: isActive ? "draft" : "active" }),
      });
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  if (isActive) {
    return (
      <Button
        variant="outline"
        size="sm"
        disabled={loading}
        onClick={toggle}
        className="hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30"
      >
        <Pause className="h-3.5 w-3.5 mr-1.5" />
        {loading ? "Pausing…" : "Pause"}
      </Button>
    );
  }

  return (
    <Button size="sm" disabled={loading} onClick={toggle}>
      <Play className="h-3.5 w-3.5 mr-1.5" />
      {loading ? "Activating…" : "Activate"}
    </Button>
  );
}
