"use client";
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { DayState, Variant } from "@site/lib/simulator/types";

const COLORS = ["#7c9cff", "#3ecf8e", "#f5a524", "#f25f8a"];
const pct = (v: number) => `${Math.round(v * 100)}%`;

/** recharts passes `unknown`-ish values to formatters; only format real numbers. */
const formatNumber = (format: (v: number) => string) => (v: unknown) => (typeof v === "number" ? format(v) : "—");

export function TrafficChart({ days, variants }: { days: DayState[]; variants: Variant[] }) {
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
            stroke={COLORS[i % COLORS.length]} fill={COLORS[i % COLORS.length]} fillOpacity={0.6} isAnimationActive={false} />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function MetricLine({ days, dataKey, label, format }: {
  days: DayState[]; dataKey: "liftVsHoldout" | "cumulativeRegret"; label: string; format: (v: number) => string;
}) {
  // Lift is null until the holdout converts; map null to undefined so the line leaves a gap.
  const data = days.map((d) => ({ day: d.day, value: d[dataKey] ?? undefined }));
  return (
    <ResponsiveContainer width="100%" height={160}>
      <LineChart data={data}>
        <CartesianGrid strokeOpacity={0.1} />
        <XAxis dataKey="day" tickLine={false} fontSize={12} />
        <YAxis tickFormatter={format} fontSize={12} width={48} />
        <Tooltip formatter={formatNumber(format)} />
        <Line type="monotone" dataKey="value" name={label} stroke="#7c9cff" dot={false} connectNulls={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
