"use client";

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";

interface ExplorationRatioProps {
  explorePercent: number;
}

export function ExplorationRatio({ explorePercent }: ExplorationRatioProps) {
  const deliverPercent = 100 - explorePercent;
  const data = [
    { name: "Explore", value: explorePercent },
    { name: "Deliver", value: deliverPercent },
  ];

  return (
    <div className="flex items-center gap-4">
      <ResponsiveContainer width={80} height={80}>
        <PieChart>
          <Pie data={data} cx="50%" cy="50%" innerRadius={25} outerRadius={36} dataKey="value" strokeWidth={0}>
            <Cell fill="hsl(var(--primary))" />
            <Cell fill="hsl(var(--muted))" />
          </Pie>
          <Tooltip formatter={(v) => `${v}%`} />
        </PieChart>
      </ResponsiveContainer>
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-primary" />
          <span className="text-xs">Explore: {explorePercent}%</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-muted-foreground" />
          <span className="text-xs">Deliver: {deliverPercent}%</span>
        </div>
        <p className="text-xs text-muted-foreground">Natural Thompson balance</p>
      </div>
    </div>
  );
}
