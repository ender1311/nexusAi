"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Play, Power } from "lucide-react";
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

export function AgentStatusToggle({
  agentId,
  agentName,
  status,
}: {
  agentId: string;
  agentName: string;
  status: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const isActive = status === "active";

  async function toggle() {
    setLoading(true);
    try {
      const res = await fetch(`/api/agents/${agentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: isActive ? "draft" : "active" }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Failed to update agent status" }));
        throw new Error(body.error ?? "Failed to update agent status");
      }
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update agent status");
    } finally {
      setLoading(false);
    }
  }

  const trigger = isActive ? (
    <Button
      variant="outline"
      size="sm"
      disabled={loading}
      className="hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30"
    >
      <Power className="h-3.5 w-3.5 mr-1.5" />
      {loading ? "Deactivating…" : "Deactivate"}
    </Button>
  ) : (
    <Button size="sm" disabled={loading}>
      <Play className="h-3.5 w-3.5 mr-1.5" />
      {loading ? "Activating…" : "Activate"}
    </Button>
  );

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger render={trigger} />
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {isActive ? `Deactivate "${agentName}"?` : `Activate "${agentName}"?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {isActive
              ? "This stops the agent and returns it to draft. All enrolled users are released from the cohort and enrollment stops. Learning and history are preserved. To stop messages without releasing the cohort, use \"Pause sending\" instead."
              : "This activates the agent. It will start enrolling eligible users and sending messages on its schedule."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant={isActive ? "destructive" : undefined}
            onClick={toggle}
          >
            {isActive ? "Deactivate agent" : "Activate agent"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
