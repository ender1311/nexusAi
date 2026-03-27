"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { TimeSeriesPoint } from "@/types/metrics";
import { formatDateShort } from "@/lib/utils";

interface TimeSeriesChartProps {
  data: TimeSeriesPoint[];
  height?: number;
  showSends?: boolean;
}

export function TimeSeriesChart({ data, height = 280, showSends = false }: TimeSeriesChartProps) {
  const formatted = data.map((d) => ({
    ...d,
    date: formatDateShort(d.date),
  }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={formatted} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          yAxisId="rate"
          tick={{ fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => `${v}%`}
        />
        {showSends && (
          <YAxis
            yAxisId="sends"
            orientation="right"
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
        )}
        <Tooltip
          contentStyle={{ fontSize: 12, borderRadius: 8 }}
          formatter={(value, name) => {
            const n = Number(value);
            if (name === "conversionRate") return [`${n}%`, "Conv. Rate"];
            if (name === "sends") return [n.toLocaleString(), "Sends"];
            return [value, name as string];
          }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line
          yAxisId="rate"
          type="monotone"
          dataKey="conversionRate"
          stroke="hsl(var(--primary))"
          strokeWidth={2}
          dot={false}
          name="conversionRate"
        />
        {showSends && (
          <Line
            yAxisId="sends"
            type="monotone"
            dataKey="sends"
            stroke="hsl(var(--muted-foreground))"
            strokeWidth={1.5}
            dot={false}
            strokeDasharray="4 4"
            name="sends"
          />
        )}
      </LineChart>
    </ResponsiveContainer>
  );
}
