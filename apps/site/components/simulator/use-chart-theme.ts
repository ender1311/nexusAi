import { useSyncExternalStore } from "react";
import type { ChartTheme, ChartThemes } from "@site/brand/chart-theme";

const DARK = "(prefers-color-scheme: dark)";

function subscribe(onChange: () => void): () => void {
  if (typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia(DARK);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

const prefersDark = () => typeof window.matchMedia === "function" && window.matchMedia(DARK).matches;

/** The chart theme for the OS color scheme (the server and first paint use light). */
export function useChartTheme(themes: ChartThemes): ChartTheme {
  const dark = useSyncExternalStore(subscribe, prefersDark, () => false);
  return dark ? themes.dark : themes.light;
}
