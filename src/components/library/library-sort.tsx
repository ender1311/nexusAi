"use client";

import { useCallback, useSyncExternalStore } from "react";
import { ArrowUpDown } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LIBRARY_SORT_OPTIONS, type LibrarySortMode } from "@/lib/library-sort";

const SORT_EVENT = "nexus:library-sort-change";

function isSortMode(v: string | null): v is LibrarySortMode {
  return !!v && LIBRARY_SORT_OPTIONS.some((o) => o.value === v);
}

/**
 * Persisted sort mode for a library, keyed by a per-library localStorage key.
 * Uses useSyncExternalStore (hydration-safe, no setState-in-effect) — mirrors the
 * sidebar's persisted nav state.
 */
export function useLibrarySort(storageKey: string): [LibrarySortMode, (mode: LibrarySortMode) => void] {
  const subscribe = useCallback((cb: () => void) => {
    window.addEventListener(SORT_EVENT, cb);
    window.addEventListener("storage", cb);
    return () => {
      window.removeEventListener(SORT_EVENT, cb);
      window.removeEventListener("storage", cb);
    };
  }, []);
  const getSnapshot = useCallback(() => localStorage.getItem(storageKey) ?? "default", [storageKey]);
  const raw = useSyncExternalStore(subscribe, getSnapshot, () => "default");
  const mode: LibrarySortMode = isSortMode(raw) ? raw : "default";

  const update = useCallback(
    (next: LibrarySortMode) => {
      try {
        localStorage.setItem(storageKey, next);
        window.dispatchEvent(new Event(SORT_EVENT));
      } catch {
        /* ignore */
      }
    },
    [storageKey],
  );

  return [mode, update];
}

export function LibrarySortSelect({
  value,
  onChange,
}: {
  value: LibrarySortMode;
  onChange: (mode: LibrarySortMode) => void;
}) {
  return (
    <Select value={value} onValueChange={(v) => v && onChange(v as LibrarySortMode)}>
      <SelectTrigger className="h-9 w-[150px] shrink-0" aria-label="Sort templates">
        <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {LIBRARY_SORT_OPTIONS.map((o) => (
          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
