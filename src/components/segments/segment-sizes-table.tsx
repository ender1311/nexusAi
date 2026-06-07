"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatNumber, formatRelativeTime } from "@/lib/utils";
import type { SizeRow } from "@/lib/segments/size-rows";

function SizeCell({ row }: { row: SizeRow }) {
  if (row.kind === "hightouch") return <span className="font-medium">{formatNumber(row.userCount)}</span>;
  if (row.sizeExact !== null) {
    return (
      <span className="font-medium">
        {formatNumber(row.sizeExact)}
        <span className="ml-2 text-xs text-muted-foreground">exact · {formatRelativeTime(row.sizeComputedAt)}</span>
      </span>
    );
  }
  if (row.estimate !== null) {
    return (
      <span className="font-medium">
        ≈ {formatNumber(row.estimate)}
        <span className="ml-2 text-xs text-muted-foreground">estimate</span>
      </span>
    );
  }
  return <span className="text-xs text-destructive">invalid rule</span>;
}

export function SegmentSizesTable({ rows }: { rows: SizeRow[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  const ruleRows = rows.filter((r): r is Extract<SizeRow, { kind: "rule" }> => r.kind === "rule");
  const ruleIds = ruleRows.map((r) => r.id);

  async function refreshOne(id: string): Promise<void> {
    const res = await fetch(`/api/segment-definitions/${id}/refresh-size`, { method: "POST" });
    if (!res.ok) throw new Error(`refresh failed: ${res.status}`);
  }

  async function handleRefresh(id: string) {
    setBusyId(id);
    try {
      await refreshOne(id);
      router.refresh();
    } catch {
      // non-blocking; the row keeps its prior value
    } finally {
      setBusyId(null);
    }
  }

  async function handleRefreshAll() {
    setProgress(`0/${ruleIds.length}`);
    for (let i = 0; i < ruleIds.length; i++) {
      try {
        await refreshOne(ruleIds[i]!); // sequential: one COUNT at a time, never parallel
      } catch {
        // skip a failed/timed-out row and continue
      }
      setProgress(`${i + 1}/${ruleIds.length}`);
    }
    setProgress(null);
    router.refresh();
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border p-8 text-center text-sm text-muted-foreground">
        No segments yet.{" "}
        <Link href="/audience/segments" className="text-primary underline">
          Build one in the segment builder
        </Link>
        .
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {ruleIds.length > 0 && (
        <div className="flex items-center justify-end gap-3">
          {progress && <span className="text-xs text-muted-foreground">Refreshing {progress}…</span>}
          <Button variant="outline" size="sm" onClick={handleRefreshAll} disabled={progress !== null}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh all
          </Button>
        </div>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Size</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.kind === "rule" ? row.id : `ht-${row.name}`}>
              <TableCell>
                <div className="font-medium">{row.name}</div>
                {row.kind === "rule" && row.description && (
                  <div className="text-xs text-muted-foreground">{row.description}</div>
                )}
              </TableCell>
              <TableCell>
                <Badge variant={row.kind === "rule" ? "default" : "secondary"}>
                  {row.kind === "rule" ? "Rule" : "Hightouch"}
                </Badge>
              </TableCell>
              <TableCell>
                <SizeCell row={row} />
              </TableCell>
              <TableCell className="text-right">
                {row.kind === "rule" && (
                  <div className="flex items-center justify-end gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRefresh(row.id)}
                      disabled={busyId === row.id || progress !== null}
                    >
                      <RefreshCw className={`h-4 w-4 ${busyId === row.id ? "animate-spin" : ""}`} />
                    </Button>
                    <Link href="/audience/segments" className="text-xs text-primary underline">
                      Edit in builder
                    </Link>
                  </div>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
