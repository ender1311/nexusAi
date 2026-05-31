// tests/regression/dashboard-agent-row-badge.test.ts
//
// REGRESSION: the dashboard Agents sidebar (src/app/page.tsx, AgentsSidebar)
// picked the right-hand label off `_count.decisions > 0`, falling back to a
// "Draft" badge when an agent had zero sends. That conflated "no sends yet"
// with draft status, so an ACTIVE agent that hadn't sent anything (e.g.
// Morpheus) was mislabeled "Draft" — directly contradicting the "Active"
// status text shown under its name. The badge must follow the real agent
// status, not the sends count. Fixed via agentRowBadge in
// src/lib/dashboard-agent-row.ts.

import { describe, expect, it } from "bun:test";
import { agentRowBadge } from "@/lib/dashboard-agent-row";

describe("regression: dashboard agent row badge follows status, not sends count", () => {
  it("labels an active agent with zero sends as sends (NOT draft) — the Morpheus bug", () => {
    expect(agentRowBadge("active", 0)).toEqual({ kind: "sends", decisions: 0 });
  });

  it("labels a draft agent as draft regardless of sends", () => {
    expect(agentRowBadge("draft", 0)).toEqual({ kind: "draft" });
    expect(agentRowBadge("draft", 500)).toEqual({ kind: "draft" });
  });

  it("shows the sends count for active and paused agents", () => {
    expect(agentRowBadge("active", 136)).toEqual({ kind: "sends", decisions: 136 });
    expect(agentRowBadge("paused", 0)).toEqual({ kind: "sends", decisions: 0 });
  });
});
