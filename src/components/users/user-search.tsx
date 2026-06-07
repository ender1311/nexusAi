"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { UserDetail, type UserDetailData } from "@/components/users/user-detail";

type SearchHit = {
  externalId: string;
  brazeId: string | null;
  email: string | null;
  name: string | null;
  funnelStage: string | null;
  personaName: string | null;
};

export function UserSearch() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [detail, setDetail] = useState<UserDetailData | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadDetail(externalId: string) {
    setLoading(true);
    setError(null);
    setDetail(null);
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(externalId)}`);
      if (!res.ok) { setError(res.status === 404 ? "User not found" : "Failed to load user"); return; }
      const body = await res.json() as { data: UserDetailData };
      setDetail(body.data);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  async function search() {
    const q = query.trim();
    if (!q) return;
    setLoading(true);
    setError(null);
    setHits(null);
    setDetail(null);
    try {
      const res = await fetch(`/api/users/search?q=${encodeURIComponent(q)}`);
      if (!res.ok) { setError("Search failed"); return; }
      const body = await res.json() as { data: SearchHit[] };
      setHits(body.data);
      if (body.data.length === 1) await loadDetail(body.data[0]!.externalId);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2 max-w-xl">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && search()}
            placeholder="External ID, Braze ID, or email…"
            className="w-full rounded-lg border bg-background pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>
        <button
          onClick={search}
          disabled={loading || !query.trim()}
          className="rounded-lg border px-4 py-2 text-sm font-medium bg-primary text-primary-foreground disabled:opacity-50 hover:opacity-90 transition-opacity"
        >
          {loading ? "…" : "Search"}
        </button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {hits && hits.length === 0 && <p className="text-sm text-muted-foreground">No users found.</p>}

      {hits && hits.length > 1 && !detail && (
        <div className="rounded-lg border divide-y max-w-xl">
          {hits.map((h) => (
            <button
              key={h.externalId}
              onClick={() => loadDetail(h.externalId)}
              className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-muted text-sm"
            >
              <span className="truncate">{h.name ?? h.email ?? h.externalId}</span>
              <span className="text-xs text-muted-foreground shrink-0">{h.funnelStage ?? "—"}</span>
            </button>
          ))}
        </div>
      )}

      {detail && <UserDetail data={detail} />}
    </div>
  );
}
