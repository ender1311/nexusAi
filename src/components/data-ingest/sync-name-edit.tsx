"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Check, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Props = {
  syncId: string;
  currentName: string;
  defaultName: string;
};

export function SyncNameEdit({ syncId, currentName, defaultName }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(currentName);
  const [name, setName] = useState(currentName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function open() {
    setValue(name);
    setError(null);
    setEditing(true);
  }

  async function save() {
    const trimmed = value.trim();
    setBusy(true);
    setError(null);
    try {
      // Clearing the field resets to the default (DELETE the override).
      const res =
        trimmed.length === 0
          ? await fetch(`/api/hightouch/syncs/${syncId}/name`, { method: "DELETE" })
          : await fetch(`/api/hightouch/syncs/${syncId}/name`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ displayName: trimmed }),
            });
      if (!res.ok) {
        setError("Could not save");
        return;
      }
      setName(trimmed.length === 0 ? defaultName : trimmed);
      setEditing(false);
      if (typeof router.refresh === "function") router.refresh();
    } catch {
      setError("Could not save");
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <span className="group inline-flex items-center gap-1.5 min-w-0">
        <span className="truncate">{name}</span>
        <button
          type="button"
          aria-label="Edit name"
          onClick={(e) => {
            e.stopPropagation();
            open();
          }}
          className="shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity hover:text-foreground"
        >
          <Pencil className="h-3 w-3" />
        </button>
      </span>
    );
  }

  return (
    <span className="inline-flex flex-col gap-0.5" onClick={(e) => e.stopPropagation()}>
      <span className="inline-flex items-center gap-1">
        <Input
          autoFocus
          value={value}
          disabled={busy}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void save();
            if (e.key === "Escape") setEditing(false);
          }}
          placeholder={defaultName}
          className="h-7 text-xs w-44"
        />
        <button
          type="button"
          aria-label="Save"
          disabled={busy}
          onClick={() => void save()}
          className="shrink-0 text-green-600 hover:text-green-700 disabled:opacity-50"
        >
          <Check className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          aria-label="Cancel"
          disabled={busy}
          onClick={() => setEditing(false)}
          className="shrink-0 text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </span>
      <span className={cn("text-[10px]", error ? "text-destructive" : "text-muted-foreground")}>
        {error ?? "Display-only — does not affect sync triggering. Clear to reset."}
      </span>
    </span>
  );
}
