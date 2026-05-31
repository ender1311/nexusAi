import { useCallback, useEffect, useState } from "react";
import type { Filters, SendRow } from "@/lib/agent-sends/types";

const PAGE_SIZE = 50;

type FetchStatus = "loading" | "idle" | "error";

export type UseAgentSends = {
  rows: SendRow[];
  status: FetchStatus;
  hasMore: boolean;
  loadingMore: boolean;
  loadMore: () => Promise<void>;
};

function buildQuery(filters: Pick<Filters, "status" | "channel">, cursor?: string): string {
  const qs = new URLSearchParams({ limit: String(PAGE_SIZE) });
  if (cursor) qs.set("cursor", cursor);
  if (filters.status !== "all") qs.set("status", filters.status);
  if (filters.channel !== "all") qs.set("channel", filters.channel);
  return qs.toString();
}

/**
 * Loads an agent's send history with cursor pagination. Re-fetches from scratch
 * whenever the server-side filters (status, channel) change; persona filtering is
 * applied client-side so it doesn't reset the page.
 */
export function useAgentSends(
  agentId: string,
  filters: Pick<Filters, "status" | "channel">,
): UseAgentSends {
  const [rows, setRows] = useState<SendRow[]>([]);
  const [status, setStatus] = useState<FetchStatus>("loading");
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  // Only server-side filters drive a re-fetch; persona filtering is client-side.
  const { status: statusFilter, channel: channelFilter } = filters;

  useEffect(() => {
    let cancelled = false;

    async function fetchInitial() {
      setRows([]);
      setCursor(null);
      setHasMore(false);
      setStatus("loading");
      try {
        const res = await fetch(
          `/api/agents/${agentId}/sends?${buildQuery({ status: statusFilter, channel: channelFilter })}`,
        );
        if (!res.ok) throw new Error("non-ok response");
        const json = (await res.json()) as { data: SendRow[] };
        if (cancelled) return;
        const fetched = json.data;
        setRows(fetched);
        setStatus("idle");
        setCursor(fetched.length > 0 ? fetched[fetched.length - 1].id : null);
        setHasMore(fetched.length === PAGE_SIZE);
      } catch {
        if (!cancelled) setStatus("error");
      }
    }

    void fetchInitial();
    return () => { cancelled = true; };
  }, [agentId, statusFilter, channelFilter]);

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetch(
        `/api/agents/${agentId}/sends?${buildQuery({ status: statusFilter, channel: channelFilter }, cursor)}`,
      );
      if (!res.ok) throw new Error("non-ok response");
      const json = (await res.json()) as { data: SendRow[] };
      const fetched = json.data;
      setRows((prev) => [...prev, ...fetched]);
      setCursor(fetched.length > 0 ? fetched[fetched.length - 1].id : null);
      setHasMore(fetched.length === PAGE_SIZE);
    } catch {
      // silently fail on load-more; existing rows remain intact
    } finally {
      setLoadingMore(false);
    }
  }, [agentId, cursor, loadingMore, statusFilter, channelFilter]);

  return { rows, status, hasMore, loadingMore, loadMore };
}
