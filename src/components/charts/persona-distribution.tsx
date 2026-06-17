"use client";

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { formatNumber } from "@/lib/utils";

const TAILWIND_HEX: Record<string, string> = {
  amber: "#f59e0b",
  blue: "#3b82f6",
  indigo: "#6366f1",
  pink: "#ec4899",
  slate: "#64748b",
  gray: "#6b7280",
  red: "#ef4444",
  purple: "#a855f7",
  green: "#22c55e",
  teal: "#14b8a6",
  orange: "#f97316",
  cyan: "#06b6d4",
};

interface TooltipPayload {
  name: string;
  value: number;
  payload: { color: string; label: string; percent: number };
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayload[] }) {
  if (!active || !payload?.length) return null;
  const item = payload[0];
  return (
    <div className="bg-background border rounded-lg shadow-lg p-3 text-xs">
      <p className="font-semibold">{item.name}</p>
      <p className="text-muted-foreground">{item.payload.label}</p>
      <p className="mt-1 font-medium">{formatNumber(item.value)} users</p>
      <p className="text-muted-foreground">{item.payload.percent}% of total</p>
    </div>
  );
}

interface PersonaDistributionChartProps {
  data: { name: string; label: string; value: number; percent: number; color: string }[];
}

export function PersonaDistributionChart({ data }: PersonaDistributionChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[280px] text-sm text-muted-foreground">
        No persona data yet
      </div>
    );
  }

  const chartData = data.map((p) => ({
    name: p.name,
    label: p.label,
    value: p.value,
    percent: p.percent,
    color: p.color,
    fill: TAILWIND_HEX[p.color] ?? "#94a3b8",
  }));

  return (
    <div className="flex items-center gap-4">
      <div className="h-[200px] w-[150px] shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              innerRadius={48}
              outerRadius={74}
              paddingAngle={2}
              dataKey="value"
              stroke="none"
            >
              {chartData.map((entry, index) => (
                <Cell key={index} fill={entry.fill} />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="flex-1 min-w-0 space-y-2">
        {chartData.map((entry) => (
          <li key={entry.name} className="flex items-center gap-2 text-xs">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: entry.fill }}
            />
            <span className="min-w-0 flex-1 truncate text-foreground" title={entry.name}>
              {entry.name}
            </span>
            <span className="shrink-0 tabular-nums font-medium text-muted-foreground">
              {entry.percent}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
