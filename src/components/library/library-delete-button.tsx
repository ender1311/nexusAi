"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
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
import { cn } from "@/lib/utils";

/**
 * Trash button + confirm dialog for archiving a library template. Calls
 * `DELETE {apiPath}?id={variantId}` and refreshes on success. The wrapping span
 * stops click propagation so deleting from inside a clickable card/row doesn't
 * also trigger the card's select handler.
 */
export function LibraryDeleteButton({
  apiPath,
  variantId,
  variantName,
  className,
}: {
  apiPath: string;
  variantId: string;
  variantName: string;
  className?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiPath}?id=${encodeURIComponent(variantId)}`, { method: "DELETE" });
      if (!res.ok) {
        setError("Failed to delete. Please try again.");
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError("Failed to delete. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <span onClick={(e) => e.stopPropagation()} className={cn("inline-flex", className)}>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogTrigger
          render={
            <button
              type="button"
              aria-label={`Delete ${variantName}`}
              title="Delete template"
              className="inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground/60 transition-colors hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          }
        />
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete template?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{variantName}</strong> will be archived and removed from this library.
              Agents that already cloned it keep their copy.
            </AlertDialogDescription>
            {error && <p className="text-sm text-destructive mt-2">{error}</p>}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={handleDelete}
              disabled={loading}
            >
              {loading ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </span>
  );
}
