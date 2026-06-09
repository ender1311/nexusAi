import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { HightouchSync } from "@/lib/hightouch/types";

// Regression: the Syncs table had status SORT but no status FILTER. Users must
// be able to filter by status (failed/warning/success) via toggleable pills.

mock.module("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {} }) }));

const { SyncsTable } = await import("@/components/data-ingest/syncs-table");
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function sync(id: string, name: string, status: string): HightouchSync {
  return {
    id,
    name,
    slug: `nexus-${id}`,
    status,
    primaryKey: "id",
    modelId: "m1",
    destinationId: "d1",
    schedule: null,
    lastRunAt: "2026-06-08T00:00:00.000Z",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-08T00:00:00.000Z",
    configuration: {},
  } as HightouchSync;
}

const SYNCS: HightouchSync[] = [
  sync("1", "Alpha", "failed"),
  sync("2", "Bravo", "success"),
  sync("3", "Charlie", "success"),
  sync("4", "Delta", "warning"),
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function pill(label: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
    .find((el) => el.textContent?.trim().startsWith(label));
}

describe("SyncsTable status filter", () => {
  it("shows all syncs by default and renders a pill per present status with counts", () => {
    act(() => root.render(<SyncsTable syncs={SYNCS} models={[]} destinations={[]} hasApiKey overrides={{}} />));
    const body = document.body.textContent ?? "";
    expect(body).toContain("Alpha");
    expect(body).toContain("Bravo");
    expect(body).toContain("Delta");
    expect(pill("Failed")).toBeDefined();
    expect(pill("Success")).toBeDefined();
    expect(pill("Warning")).toBeDefined();
    expect(pill("Success")!.textContent).toContain("2");
  });

  it("filters to only failed rows when the Failed pill is clicked", () => {
    act(() => root.render(<SyncsTable syncs={SYNCS} models={[]} destinations={[]} hasApiKey overrides={{}} />));
    act(() => pill("Failed")!.click());
    const body = document.body.textContent ?? "";
    expect(body).toContain("Alpha");
    expect(body).not.toContain("Bravo");
    expect(body).not.toContain("Charlie");
    expect(body).not.toContain("Delta");
  });

  it("clears the filter when the All pill is clicked", () => {
    act(() => root.render(<SyncsTable syncs={SYNCS} models={[]} destinations={[]} hasApiKey overrides={{}} />));
    act(() => pill("Failed")!.click());
    act(() => pill("All")!.click());
    const body = document.body.textContent ?? "";
    expect(body).toContain("Alpha");
    expect(body).toContain("Bravo");
    expect(body).toContain("Delta");
  });
});
