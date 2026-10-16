import { DEMO_SOURCES, type DemoSource } from "@site/content/demo-lumen";

export const STEP_COUNT = 6;
export type DemoStep = 1 | 2 | 3 | 4 | 5 | 6;
const DEFAULT_SOURCE: DemoSource = "contentful";

export function clampStep(n: number): DemoStep {
  return Math.min(Math.max(n, 1), STEP_COUNT) as DemoStep;
}

export function parseDemoParams(sp: URLSearchParams): { step: DemoStep; source: DemoSource } {
  const step = clampStep(parseInt(sp.get("step") ?? "1", 10) || 1);
  const raw = sp.get("source");
  const source = DEMO_SOURCES.find((s) => s === raw) ?? DEFAULT_SOURCE;
  return { step, source };
}

export function toSearch(step: number, source: DemoSource): string {
  return `?step=${step}&source=${source}`;
}
