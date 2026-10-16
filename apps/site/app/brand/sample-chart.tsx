"use client";
import type { ChartThemes } from "@site/brand/chart-theme";
import { MetricLine } from "@site/components/simulator/charts";
import type { DayState } from "@site/lib/simulator/types";

/** A client wrapper so the server preview page doesn't pass a formatter function across the boundary. */
export function SampleChart({ days, themes }: { days: DayState[]; themes: ChartThemes }) {
  return <MetricLine days={days} dataKey="cumulativeRegret" label="Regret" format={(v) => v.toFixed(0)} themes={themes} />;
}
