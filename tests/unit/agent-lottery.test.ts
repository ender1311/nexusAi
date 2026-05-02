import { describe, expect, it } from "bun:test";
import { buildAgentLottery } from "@/lib/engine/agent-lottery";

describe("buildAgentLottery", () => {
  it("returns empty map for empty input", () => {
    expect(buildAgentLottery(new Map()).size).toBe(0);
  });

  it("returns empty map when all agent pools are empty", () => {
    const input = new Map([["agentA", [] as string[]], ["agentB", [] as string[]]]);
    expect(buildAgentLottery(input).size).toBe(0);
  });

  it("assigns all users to the single agent", () => {
    const input = new Map([["agentA", ["u1", "u2", "u3"]]]);
    const result = buildAgentLottery(input);
    expect(result.size).toBe(3);
    expect(result.get("u1")).toBe("agentA");
    expect(result.get("u2")).toBe("agentA");
    expect(result.get("u3")).toBe("agentA");
  });

  it("assigns each user to their only agent when pools are disjoint", () => {
    const input = new Map([
      ["agentA", ["u1", "u2"]],
      ["agentB", ["u3", "u4"]],
    ]);
    const result = buildAgentLottery(input);
    expect(result.get("u1")).toBe("agentA");
    expect(result.get("u2")).toBe("agentA");
    expect(result.get("u3")).toBe("agentB");
    expect(result.get("u4")).toBe("agentB");
  });

  it("assigns each shared user to exactly one agent (no user appears twice)", () => {
    const input = new Map([
      ["agentA", ["u1", "u2", "u3"]],
      ["agentB", ["u1", "u2", "u3"]],
    ]);
    const result = buildAgentLottery(input);
    // map size = 3 (one entry per user, not 6)
    expect(result.size).toBe(3);
    for (const userId of ["u1", "u2", "u3"]) {
      const assigned = result.get(userId);
      expect(assigned).toBeDefined();
      expect(["agentA", "agentB"]).toContain(assigned!);
    }
  });

  it("produces approximately uniform distribution for 3 agents sharing a large pool", () => {
    const userIds = Array.from({ length: 900 }, (_, i) => `user${i}`);
    const input = new Map([
      ["agentA", userIds],
      ["agentB", userIds],
      ["agentC", userIds],
    ]);
    const result = buildAgentLottery(input);
    const counts: Record<string, number> = { agentA: 0, agentB: 0, agentC: 0 };
    for (const agentId of result.values()) {
      counts[agentId] = (counts[agentId] ?? 0) + 1;
    }
    // Each agent gets ~300 ± 90 (30% slack around expected 300)
    expect(counts["agentA"]).toBeGreaterThan(200);
    expect(counts["agentB"]).toBeGreaterThan(200);
    expect(counts["agentC"]).toBeGreaterThan(200);
    // Total = 900 (each user assigned exactly once)
    expect(result.size).toBe(900);
  });

  it("agent with empty pool does not steal users from a pool-sharing partner", () => {
    const input = new Map([
      ["agentA", [] as string[]],
      ["agentB", ["u1", "u2"]],
    ]);
    const result = buildAgentLottery(input);
    expect(result.get("u1")).toBe("agentB");
    expect(result.get("u2")).toBe("agentB");
  });

  it("mixed disjoint and shared: disjoint users go to their agent, shared users go to one", () => {
    const input = new Map([
      ["agentA", ["exclusive_A", "shared"]],
      ["agentB", ["exclusive_B", "shared"]],
    ]);
    const result = buildAgentLottery(input);
    expect(result.get("exclusive_A")).toBe("agentA");
    expect(result.get("exclusive_B")).toBe("agentB");
    const sharedAssigned = result.get("shared");
    expect(sharedAssigned).toBeDefined();
    expect(["agentA", "agentB"]).toContain(sharedAssigned!);
    // Still only one entry for "shared"
    expect(result.size).toBe(3);
  });
});
