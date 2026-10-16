"use client";
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ChartThemes } from "@site/brand/chart-theme";
import type { DayState, Variant } from "@site/lib/simulator/types";
import { chartChrome } from "./chart-chrome";
import { useChartTheme } from "./use-chart-theme";

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** recharts passes `unknown`-ish values to formatters; only format real numbers. */
const formatNumber = (format: (v: number) => string) => (v: unknown) => (typeof v === "number" ? format(v) : "—");

export function TrafficChart({ days, variants, themes }: { days: DayState[]; variants: Variant[]; themes: ChartThemes }) {
  const theme = useChartTheme(themes);
  const chrome = chartChrome(theme);
  const data = days.map((d) => ({ day: d.day, ...d.trafficShare }));
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} stackOffset="expand">
        <CartesianGrid stroke={chrome.gridStroke} />
        <XAxis dataKey="day" tickLine={false} tick={chrome.tick} stroke={chrome.axisStroke} />
        <YAxis tickFormatter={pct} tick={chrome.tick} stroke={chrome.axisStroke} width={40} />
        <Tooltip formatter={formatNumber(pct)} {...chrome.tooltip} />
        {variants.map((v, i) => (
          <Area key={v.id} type="monotone" dataKey={v.id} name={`${v.id} · ${v.label}`} stackId="1"
            stroke={theme.series[i % theme.series.length]} fill={theme.series[i % theme.series.length]} fillOpacity={0.6} isAnimationActive={false} />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function MetricLine({ days, dataKey, label, format, themes }: {
  days: DayState[]; dataKey: "liftVsHoldout" | "cumulativeRegret"; label: string; format: (v: number) => string; themes: ChartThemes;
}) {
  const theme = useChartTheme(themes);
  const chrome = chartChrome(theme);
  // Lift is null until the holdout has enough conversions; map null to undefined so the line leaves a gap.
  const data = days.map((d) => ({ day: d.day, value: d[dataKey] ?? undefined }));
  return (
    <ResponsiveContainer width="100%" height={160}>
      <LineChart data={data}>
        <CartesianGrid stroke={chrome.gridStroke} />
        <XAxis dataKey="day" tickLine={false} tick={chrome.tick} stroke={chrome.axisStroke} />
        <YAxis tickFormatter={format} tick={chrome.tick} stroke={chrome.axisStroke} width={48} />
        <Tooltip formatter={formatNumber(format)} {...chrome.tooltip} />
        <Line type="monotone" dataKey="value" name={label} stroke={theme.series[0]} dot={false} connectNulls={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
