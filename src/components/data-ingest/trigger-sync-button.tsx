"use client";

import { useState } from "react";
import { Play, Loader2 } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

type TriggerSyncButtonProps = {
  syncId: string;
  syncName: string;
};

export function TriggerSyncButton({ syncId, syncName }: TriggerSyncButtonProps) {
  const [open, setOpen] = useState(false);
  const [fullResync, setFullResync] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleTrigger() {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/hightouch/syncs/${syncId}/trigger`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ full_resync: fullResync }),
      });
      if (res.ok) {
        setMessage("Sync triggered successfully");
        setOpen(false);
      } else {
        setMessage("Failed to trigger sync");
      }
    } catch {
      setMessage("Failed to trigger sync");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {message && (
        <span className={`text-xs mr-1 ${message.startsWith("Failed") ? "text-red-600" : "text-green-600"}`}>
          {message}
        </span>
      )}
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogTrigger>
          <Button size="sm" variant="outline" className="h-7 text-xs">
            <Play className="h-3 w-3 mr-1" />
            Trigger
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Trigger sync</AlertDialogTitle>
            <AlertDialogDescription>
              This will trigger a sync run for <strong>{syncName}</strong>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex items-center gap-2 py-1">
            <Switch
              id={`full-resync-${syncId}`}
              checked={fullResync}
              onCheckedChange={setFullResync}
            />
            <Label htmlFor={`full-resync-${syncId}`} className="text-sm cursor-pointer">
              Full resync
            </Label>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleTrigger}
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  Triggering…
                </>
              ) : (
                "Trigger"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
