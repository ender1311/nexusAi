import type { ChartTheme } from "@site/brand/chart-theme";

/** Recharts props for axes, grid and tooltip, from the brand's chart theme. */
export function chartChrome(theme: ChartTheme) {
  return {
    tick: { fill: theme.ink3, fontSize: 12 },
    axisStroke: theme.line,
    gridStroke: theme.line,
    tooltip: {
      contentStyle: { background: theme.surface, border: `1px solid ${theme.line}`, borderRadius: theme.radius, color: theme.ink },
      labelStyle: { color: theme.ink },
      itemStyle: { color: theme.ink },
    },
  };
}
