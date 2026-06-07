import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

// Regression: the sidebar was restructured from a flat list into a nested,
// collapsible tree. Groups must collapse/expand, the active route's group must
// auto-expand, and deep routes must highlight the most-specific child.

let pathname = "/";
mock.module("next/navigation", () => ({ usePathname: () => pathname }));

const { Sidebar } = await import("@/components/layout/sidebar");
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function groupHeader(label: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
    .find((el) => el.textContent?.includes(label));
}
function link(label: string): HTMLAnchorElement | undefined {
  return Array.from(document.querySelectorAll<HTMLAnchorElement>("a"))
    .find((el) => el.textContent?.includes(label));
}

describe("Sidebar nested nav", () => {
  it("hides a collapsed group's children until its header is clicked", () => {
    pathname = "/agents";
    act(() => root.render(<Sidebar user={null} />));
    expect(link("Search Users")).toBeUndefined();
    act(() => groupHeader("Audience")!.click());
    expect(link("Search Users")).toBeDefined();
  });

  it("auto-expands the group containing the active route", () => {
    pathname = "/control-tower";
    act(() => root.render(<Sidebar user={null} />));
    const active = link("Control Tower");
    expect(active).toBeDefined();
    expect(active!.getAttribute("aria-current")).toBe("page");
  });

  it("highlights the most-specific child for a deep route", () => {
    pathname = "/demo/deep-dive/feature-vectors";
    act(() => root.render(<Sidebar user={null} />));
    expect(link("Advanced Docs")!.getAttribute("aria-current")).toBe("page");
    expect(link("Demo")!.getAttribute("aria-current")).toBeNull();
  });
});
