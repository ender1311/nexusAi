"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { TimeSeriesPoint } from "@/types/metrics";
import { formatDateShort } from "@/lib/utils";

interface DailySendsChartProps {
  data: TimeSeriesPoint[];
  height?: number;
}

export function DailySendsChart({ data, height = 280 }: DailySendsChartProps) {
  const formatted = data.map((d) => ({
    ...d,
    date: formatDateShort(d.date),
  }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={formatted} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          interval="preserveStartEnd"
        />
        <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
        <Tooltip
          contentStyle={{ fontSize: 12, borderRadius: 8 }}
          formatter={(value) => [Number(value).toLocaleString(), "Sends"]}
        />
        <Bar dataKey="sends" fill="hsl(var(--primary))" radius={[2, 2, 0, 0]} opacity={0.8} />
      </BarChart>
    </ResponsiveContainer>
  );
}
