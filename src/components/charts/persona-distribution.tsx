"use client";

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from "recharts";
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
    <ResponsiveContainer width="100%" height={280}>
      <PieChart>
        <Pie
          data={chartData}
          cx="50%"
          cy="50%"
          innerRadius={60}
          outerRadius={100}
          paddingAngle={2}
          dataKey="value"
        >
          {chartData.map((entry, index) => (
            <Cell key={index} fill={entry.fill} />
          ))}
        </Pie>
        <Tooltip content={<CustomTooltip />} />
        <Legend
          layout="vertical"
          align="right"
          verticalAlign="middle"
          formatter={(value) => <span className="text-xs">{value}</span>}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
