"use client";

import { useState, useRef, useCallback } from "react";
import { Pencil, Check, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  agentId: string;
  initialName: string;
};

export function AgentNameEditor({ agentId, initialName }: Props) {
  const [name, setName] = useState(initialName);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialName);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const startEdit = useCallback(() => {
    setDraft(name);
    setEditing(true);
    setTimeout(() => {
      inputRef.current?.select();
    }, 0);
  }, [name]);

  const cancel = useCallback(() => {
    setEditing(false);
    setDraft(name);
  }, [name]);

  const save = useCallback(async () => {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === name) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/agents/${agentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (res.ok) {
        setName(trimmed);
        if (savedTimerRef.current !== null) clearTimeout(savedTimerRef.current);
        setSavedAt(Date.now());
        savedTimerRef.current = setTimeout(() => setSavedAt(null), 2000);
      }
    } finally {
      setSaving(false);
      setEditing(false);
    }
  }, [agentId, draft, name]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") save();
      if (e.key === "Escape") cancel();
    },
    [save, cancel],
  );

  if (editing) {
    return (
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={save}
          className="text-lg font-semibold bg-transparent border-b-2 border-primary outline-none w-full max-w-xs"
          disabled={saving}
        />
        {saving ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />
        ) : (
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onMouseDown={(e) => { e.preventDefault(); save(); }}
              className="rounded p-0.5 hover:bg-muted text-green-600"
              aria-label="Save name"
            >
              <Check className="h-4 w-4" />
            </button>
            <button
              type="button"
              onMouseDown={(e) => { e.preventDefault(); cancel(); }}
              className="rounded p-0.5 hover:bg-muted text-muted-foreground"
              aria-label="Cancel"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 group">
      <h1 className="text-lg font-semibold">{name}</h1>
      <button
        type="button"
        onClick={startEdit}
        className={cn(
          "rounded p-1 text-muted-foreground transition-opacity hover:bg-muted",
          savedAt !== null ? "opacity-100" : "opacity-0 group-hover:opacity-100",
        )}
        aria-label="Rename agent"
      >
        {savedAt !== null ? (
          <Check className="h-3.5 w-3.5 text-green-600" />
        ) : (
          <Pencil className="h-3.5 w-3.5" />
        )}
      </button>
    </div>
  );
}
