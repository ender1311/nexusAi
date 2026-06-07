"use client";

import { useState } from "react";
import { Search, User } from "lucide-react";
import { UserDetail, type UserDetailData } from "@/components/users/user-detail";

export { BetaBar } from "@/components/users/user-detail";

export function UserInspector() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<UserDetailData | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function lookup(id: string) {
    if (!id.trim()) return;
    setLoading(true); setError(null); setResult(null);
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(id.trim())}`);
      if (res.status === 404) { setError("User not found"); return; }
      if (!res.ok) { setError("Failed to fetch user"); return; }
      const body = await res.json() as { data: UserDetailData };
      setResult(body.data);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <User className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">User Inspector</h2>
        </div>
        <span className="text-xs text-muted-foreground">Live profile + arm stats per user</span>
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && lookup(query)}
            placeholder="Enter user external ID…"
            className="w-full rounded-lg border bg-background pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>
        <button
          onClick={() => lookup(query)}
          disabled={loading || !query.trim()}
          className="rounded-lg border px-4 py-2 text-sm font-medium bg-primary text-primary-foreground disabled:opacity-50 hover:opacity-90 transition-opacity"
        >
          {loading ? "…" : "Inspect"}
        </button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {result && <UserDetail data={result} />}
    </div>
  );
}
