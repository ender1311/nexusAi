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
