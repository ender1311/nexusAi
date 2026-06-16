"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
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

/**
 * Global send kill switch. Two concerns kept visually separate:
 *  - a status pill showing the CURRENT global state (sending live vs. paused)
 *  - an action button whose label/color/icon describe what CLICKING does
 *    (the inverse of the current state), so red/green always map to the action,
 *    not the state.
 */
export function KillSwitchToggle({ initialOn }: { initialOn: boolean }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  // initialOn === true  → sending is globally PAUSED (kill switch engaged)
  // initialOn === false → sending is LIVE
  const paused = initialOn;

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
      toast.success(on ? "All sending paused" : "Sending resumed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update kill switch");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
          paused
            ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
            : "bg-green-500/15 text-green-600 dark:text-green-400",
        )}
      >
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            paused ? "bg-amber-500" : "bg-green-500 animate-pulse",
          )}
        />
        {paused ? "All sending paused" : "Sending live"}
      </span>

      <AlertDialog>
        <AlertDialogTrigger
          render={
            paused ? (
              <Button
                size="sm"
                disabled={loading}
                className="bg-green-600 text-white hover:bg-green-700 border-transparent"
              >
                <Play className="h-3.5 w-3.5 mr-1.5" />
                {loading ? "Resuming…" : "Resume all sending"}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                disabled={loading}
                className="border-destructive/40 text-destructive hover:bg-destructive/10"
              >
                <Pause className="h-3.5 w-3.5 mr-1.5" />
                {loading ? "Pausing…" : "Pause all sending"}
              </Button>
            )
          }
        />
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {paused ? "Resume all sending?" : "Pause all sending?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {paused
                ? "This resumes sending across every active agent on the next cron run. Agents you paused individually stay paused."
                : "This immediately pauses ALL sending across every agent — a global kill switch. Cohorts, assignments, and learning are preserved. You can resume at any time."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            {paused ? (
              <AlertDialogAction
                onClick={() => setKill(false)}
                className="bg-green-600 text-white hover:bg-green-700"
              >
                Resume all sending
              </AlertDialogAction>
            ) : (
              <AlertDialogAction variant="destructive" onClick={() => setKill(true)}>
                Pause all sending
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
