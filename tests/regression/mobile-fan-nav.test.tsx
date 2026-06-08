import { describe, expect, it } from "bun:test";
import {
  navTree,
  flattenItems,
  mobileTabs,
  isDivider,
  mobileTabLabel,
  activeMobileTabLabel,
} from "@/components/layout/nav-config";

// Regression: the mobile bottom nav was a hardcoded 5-item list with no subpage
// access. It is now derived from navTree as `mobileTabs` (a fan-up popover), and
// every navTree page must stay reachable on mobile.

describe("mobileTabs data model", () => {
  it("exposes exactly five tabs in the required order", () => {
    expect(mobileTabs.map(mobileTabLabel)).toEqual([
      "Dashboard",
      "Agents",
      "Audience",
      "Data",
      "About",
    ]);
  });

  it("makes the Agents tab a direct link (no fan)", () => {
    const agents = mobileTabs.find((t) => mobileTabLabel(t) === "Agents");
    expect(agents?.kind).toBe("link");
    if (agents?.kind === "link") expect(agents.item.href).toBe("/agents");
  });

  it("keeps every navTree leaf reachable through some tab", () => {
    const reachable = new Set<string>();
    for (const tab of mobileTabs) {
      if (tab.kind === "link") {
        reachable.add(tab.item.href);
      } else {
        for (const child of tab.children) {
          if (!isDivider(child)) reachable.add(child.href);
        }
      }
    }
    for (const item of flattenItems(navTree)) {
      expect(reachable.has(item.href)).toBe(true);
    }
  });

  it("folds Content libraries + Settings into the About fan after a divider", () => {
    const about = mobileTabs.find((t) => mobileTabLabel(t) === "About");
    expect(about?.kind).toBe("fan");
    if (about?.kind !== "fan") throw new Error("About tab must be a fan");

    const labels = about.children.map((c) => (isDivider(c) ? "---" : c.label));
    expect(labels).toEqual([
      "About",
      "Architecture",
      "Advanced Docs",
      "FAQ",
      "Demo",
      "---",
      "Push Library",
      "Email Library",
      "Verse Library",
      "Settings",
    ]);
  });

  it("resolves the active tab from the pathname", () => {
    expect(activeMobileTabLabel("/")).toBe("Dashboard");
    expect(activeMobileTabLabel("/control-tower")).toBe("Dashboard");
    expect(activeMobileTabLabel("/agents/abc/goals")).toBe("Agents");
    expect(activeMobileTabLabel("/audience/segments")).toBe("Audience");
    expect(activeMobileTabLabel("/settings")).toBe("About");
    expect(activeMobileTabLabel("/messages")).toBe("About");
    expect(activeMobileTabLabel("/personas")).toBe("Data");
  });
});

import { afterEach, beforeEach, mock } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

let pathname = "/";
mock.module("next/navigation", () => ({ usePathname: () => pathname }));

const { MobileNav } = await import("@/components/layout/sidebar");
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  pathname = "/";
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function tabButton(label: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
    .find((el) => el.textContent?.includes(label));
}
function pill(label: string): HTMLAnchorElement | undefined {
  return Array.from(container.querySelectorAll<HTMLAnchorElement>("a"))
    .find((el) => el.textContent?.includes(label));
}
function openFanPanel(): HTMLDivElement | undefined {
  return Array.from(container.querySelectorAll<HTMLDivElement>("div"))
    .find((el) => el.className.includes("bottom-full"));
}

describe("MobileNav fan-up popover", () => {
  it("hides a fan tab's pills until the tab is tapped", () => {
    act(() => root.render(<MobileNav />));
    expect(pill("Search Users")).toBeUndefined();
    act(() => tabButton("Audience")!.click());
    expect(pill("Search Users")).toBeDefined();
    expect(pill("Segments")).toBeDefined();
    expect(pill("Sizes")).toBeDefined();
  });

  it("renders Agents as a direct link with no fan button", () => {
    act(() => root.render(<MobileNav />));
    const agents = pill("Agents");
    expect(agents).toBeDefined();
    expect(agents!.getAttribute("href")).toBe("/agents");
    expect(tabButton("Agents")).toBeUndefined();
  });

  it("exposes Content libraries + Settings inside the About fan", () => {
    act(() => root.render(<MobileNav />));
    act(() => tabButton("About")!.click());
    expect(pill("Push Library")).toBeDefined();
    expect(pill("Email Library")).toBeDefined();
    expect(pill("Verse Library")).toBeDefined();
    expect(pill("Settings")).toBeDefined();
    expect(pill("Architecture")).toBeDefined();
  });

  it("closes an open fan when the scrim is tapped", () => {
    act(() => root.render(<MobileNav />));
    act(() => tabButton("Data")!.click());
    expect(pill("Personas")).toBeDefined();
    const scrim = container.querySelector<HTMLDivElement>('[aria-hidden="true"]');
    expect(scrim).toBeDefined();
    act(() => scrim!.click());
    expect(pill("Personas")).toBeUndefined();
  });

  it("marks the tab active when the route is one of its pages", () => {
    pathname = "/audience/segments";
    act(() => root.render(<MobileNav />));
    expect(tabButton("Audience")!.className).toContain("text-primary");
    expect(tabButton("Data")!.className).not.toContain("text-primary");
  });

  // Regression: the fan was centered on its tab (`left-1/2 -translate-x-1/2`),
  // so the leftmost (Dashboard) and rightmost (About) fans ran off the edge of
  // the phone viewport. Edge tabs must anchor inward; all fans cap width/height.
  it("anchors the leftmost fan flush-left, not centered", () => {
    act(() => root.render(<MobileNav />));
    act(() => tabButton("Dashboard")!.click());
    const panel = openFanPanel();
    expect(panel).toBeDefined();
    expect(panel!.className).toContain("left-1");
    expect(panel!.className).not.toContain("left-1/2");
    expect(panel!.className).not.toContain("-translate-x-1/2");
  });

  it("anchors the rightmost fan flush-right, not centered", () => {
    act(() => root.render(<MobileNav />));
    act(() => tabButton("About")!.click());
    const panel = openFanPanel();
    expect(panel).toBeDefined();
    expect(panel!.className).toContain("right-1");
    expect(panel!.className).not.toContain("-translate-x-1/2");
  });

  it("centers a middle fan on its tab", () => {
    act(() => root.render(<MobileNav />));
    act(() => tabButton("Audience")!.click());
    const panel = openFanPanel();
    expect(panel).toBeDefined();
    expect(panel!.className).toContain("-translate-x-1/2");
  });

  it("caps fan width and height so it stays within the viewport", () => {
    act(() => root.render(<MobileNav />));
    act(() => tabButton("About")!.click());
    const panel = openFanPanel();
    expect(panel).toBeDefined();
    expect(panel!.className).toContain("max-w-[calc(100vw-0.5rem)]");
    expect(panel!.className).toContain("max-h-[70vh]");
    expect(panel!.className).toContain("overflow-y-auto");
  });
});
