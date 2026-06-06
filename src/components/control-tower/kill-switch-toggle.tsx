"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Power } from "lucide-react";
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

export function KillSwitchToggle({ initialOn }: { initialOn: boolean }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function setKill(on: boolean) {
    setLoading(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ global_sending_paused: on ? "true" : "false" }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Failed to update kill switch" }));
        throw new Error(body.error ?? "Failed to update kill switch");
      }
      router.refresh();
      toast.success(on ? "Kill switch ON — all sending paused" : "Kill switch OFF — sending resumed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update kill switch");
    } finally {
      setLoading(false);
    }
  }

  if (initialOn) {
    return (
      <AlertDialog>
        <AlertDialogTrigger
          render={
            <Button size="sm" variant="destructive" disabled={loading}>
              <Power className="h-3.5 w-3.5 mr-1.5" />
              {loading ? "Resuming…" : "Kill switch ON — Resume all"}
            </Button>
          }
        />
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Turn off kill switch?</AlertDialogTitle>
            <AlertDialogDescription>
              This resumes ALL sending across every agent. Communications will start
              going out again on the next cron run.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => setKill(false)}>
              Resume all sending
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button
            size="sm"
            variant="outline"
            disabled={loading}
            className="border-destructive/40 text-destructive hover:bg-destructive/10"
          >
            <Power className="h-3.5 w-3.5 mr-1.5" />
            Kill switch
          </Button>
        }
      />
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>Activate kill switch?</AlertDialogTitle>
          <AlertDialogDescription>
            This immediately pauses ALL sending across every agent. Cohorts, assignments,
            and learning are preserved. You can turn it back off at any time.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => setKill(true)}>
            Activate kill switch
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
