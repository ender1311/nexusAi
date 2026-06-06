"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

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
  const [open, setOpen] = useState(false);

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
      setOpen(false);
      router.refresh();
      toast.success(next ? `"${agentName}" paused` : `"${agentName}" resumed`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update sending state");
    } finally {
      setLoading(false);
    }
  }

  const trigger = sendingPaused ? (
    <Button size="sm" variant="outline" disabled={loading}>
      <Play className="h-3.5 w-3.5 mr-1.5" />
      {loading ? "Resuming…" : "Resume"}
    </Button>
  ) : (
    <Button
      size="sm"
      variant="outline"
      disabled={loading}
      title={killSwitchOn ? "Kill switch is on — global send is paused" : undefined}
      className="hover:bg-amber-500/10 hover:text-amber-600 hover:border-amber-500/30"
    >
      <Pause className="h-3.5 w-3.5 mr-1.5" />
      {loading ? "Pausing…" : "Pause"}
    </Button>
  );

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger render={trigger} />
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {sendingPaused ? `Resume "${agentName}"?` : `Pause "${agentName}"?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {sendingPaused
              ? "This resumes all communications from this agent going out. You can pause it again at any time."
              : "This immediately pauses all communications from this agent going out. Cohorts, assignments, and learning are preserved. You can resume at any time."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant={sendingPaused ? undefined : "destructive"}
            onClick={toggle}
          >
            {sendingPaused ? "Resume sending" : "Pause sending"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
