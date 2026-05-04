"use client";

import { Fragment, useEffect, useState } from "react";
import { Loader2, Send } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type SendRow = {
  id: string;
  userId: string;
  channel: string;
  sentAt: string;
  scheduledFor: string | null;
  variantId: string | null;
  variantName: string | null;
  variantBody: string;
  brazeSendId: string | null;
};

type Props = { agentId: string };

const formatDateTime = (dateStr: string): string =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(dateStr));

const formatDateGroup = (dateStr: string): string =>
  new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(dateStr));

const toDateKey = (dateStr: string): string => new Date(dateStr).toLocaleDateString("en-CA");

const truncateUserId = (userId: string): string =>
  userId.length > 12 ? `${userId.slice(0, 12)}…` : userId;

type GroupedRows = { dateKey: string; label: string; rows: SendRow[] }[];

function groupByDate(rows: SendRow[]): GroupedRows {
  const map = new Map<string, { label: string; rows: SendRow[] }>();

  for (const row of rows) {
    const key = toDateKey(row.sentAt);
    if (!map.has(key)) {
      map.set(key, { label: formatDateGroup(row.sentAt), rows: [] });
    }
    map.get(key)!.rows.push(row);
  }

  return Array.from(map.entries()).map(([dateKey, { label, rows }]) => ({
    dateKey,
    label,
    rows,
  }));
}

export function AgentSendsTable({ agentId }: Props) {
  const [rows, setRows] = useState<SendRow[]>([]);
  const [status, setStatus] = useState<"loading" | "idle" | "error">("loading");
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function fetchInitial() {
      setStatus("loading");
      try {
        const res = await fetch(`/api/agents/${agentId}/sends?limit=50`);
        if (!res.ok) throw new Error("non-ok response");
        const json = (await res.json()) as { data: SendRow[] };
        if (cancelled) return;
        const fetched = json.data;
        setRows(fetched);
        setStatus("idle");
        const lastId = fetched.length > 0 ? fetched[fetched.length - 1].id : null;
        setCursor(lastId);
        setHasMore(fetched.length === 50);
      } catch {
        if (!cancelled) setStatus("error");
      }
    }

    void fetchInitial();
    return () => { cancelled = true; };
  }, [agentId]);

  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetch(`/api/agents/${agentId}/sends?limit=50&cursor=${cursor}`);
      if (!res.ok) throw new Error("non-ok response");
      const json = (await res.json()) as { data: SendRow[] };
      const fetched = json.data;
      setRows((prev) => [...prev, ...fetched]);
      const lastId = fetched.length > 0 ? fetched[fetched.length - 1].id : null;
      setCursor(lastId);
      setHasMore(fetched.length === 50);
    } catch {
      // silently fail on load-more; rows already shown remain intact
    } finally {
      setLoadingMore(false);
    }
  }

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (status === "error") {
    return (
      <p className="text-center py-8 text-sm text-red-500/80">Failed to load sends.</p>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
        <Send className="h-8 w-8 mx-auto mb-2 opacity-40" />
        <p className="text-sm font-medium">No sends yet</p>
        <p className="text-xs mt-1">Sends appear here once the cron job delivers messages for this agent.</p>
      </div>
    );
  }

  const groups = groupByDate(rows);

  return (
    <div className="space-y-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[140px]">User</TableHead>
            <TableHead>Variant</TableHead>
            <TableHead className="w-[100px]">Channel</TableHead>
            <TableHead className="w-[180px]">Scheduled For</TableHead>
            <TableHead className="w-[180px]">Initiated</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.map(({ dateKey, label, rows: groupRows }) => (
            <Fragment key={dateKey}>
              <TableRow className="hover:bg-transparent">
                <TableCell
                  colSpan={5}
                  className="py-2 px-4 text-xs font-medium text-muted-foreground bg-muted/40 border-y"
                >
                  {label}
                </TableCell>
              </TableRow>
              {groupRows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {truncateUserId(row.userId)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {row.variantName ?? <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs capitalize">
                      {row.channel}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {row.scheduledFor ? formatDateTime(row.scheduledFor) : "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDateTime(row.sentAt)}
                  </TableCell>
                </TableRow>
              ))}
            </Fragment>
          ))}
        </TableBody>
      </Table>

      {hasMore && (
        <div className="flex justify-center pt-2">
          <Button variant="outline" size="sm" onClick={() => void loadMore()} disabled={loadingMore}>
            {loadingMore ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                Loading…
              </>
            ) : (
              "Load more"
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
