"use client";
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { DayState, Variant } from "@site/lib/simulator/types";

/** Series colors, from the brand preset (recharts needs literal values, not CSS variables). */
export type ChartPalette = readonly string[];
const pct = (v: number) => `${Math.round(v * 100)}%`;

/** recharts passes `unknown`-ish values to formatters; only format real numbers. */
const formatNumber = (format: (v: number) => string) => (v: unknown) => (typeof v === "number" ? format(v) : "—");

export function TrafficChart({ days, variants, palette }: { days: DayState[]; variants: Variant[]; palette: ChartPalette }) {
  const data = days.map((d) => ({ day: d.day, ...d.trafficShare }));
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} stackOffset="expand">
        <CartesianGrid strokeOpacity={0.1} />
        <XAxis dataKey="day" tickLine={false} fontSize={12} />
        <YAxis tickFormatter={pct} fontSize={12} width={40} />
        <Tooltip formatter={formatNumber(pct)} />
        {variants.map((v, i) => (
          <Area key={v.id} type="monotone" dataKey={v.id} name={`${v.id} · ${v.label}`} stackId="1"
            stroke={palette[i % palette.length]} fill={palette[i % palette.length]} fillOpacity={0.6} isAnimationActive={false} />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function MetricLine({ days, dataKey, label, format, palette }: {
  days: DayState[]; dataKey: "liftVsHoldout" | "cumulativeRegret"; label: string; format: (v: number) => string; palette: ChartPalette;
}) {
  // Lift is null until the holdout has enough conversions; map null to undefined so the line leaves a gap.
  const data = days.map((d) => ({ day: d.day, value: d[dataKey] ?? undefined }));
  return (
    <ResponsiveContainer width="100%" height={160}>
      <LineChart data={data}>
        <CartesianGrid strokeOpacity={0.1} />
        <XAxis dataKey="day" tickLine={false} fontSize={12} />
        <YAxis tickFormatter={format} fontSize={12} width={48} />
        <Tooltip formatter={formatNumber(format)} />
        <Line type="monotone" dataKey="value" name={label} stroke={palette[0]} dot={false} connectNulls={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
