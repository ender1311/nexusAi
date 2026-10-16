"use client";
import { MetricLine } from "@site/components/simulator/charts";
import type { DayState } from "@site/lib/simulator/types";

/** A client wrapper so the server preview page doesn't pass a formatter function across the boundary. */
export function SampleChart({ days, palette }: { days: DayState[]; palette: readonly string[] }) {
  return <MetricLine days={days} dataKey="cumulativeRegret" label="Regret" format={(v) => v.toFixed(0)} palette={palette} />;
}
