import { describe, expect, it } from "bun:test";
import { diffAgentSettings } from "@/lib/agents/settings-diff";

describe("diffAgentSettings", () => {
  it("returns only changed agent fields", () => {
    const { agentPatch, schedulingPut } = diffAgentSettings(
      { name: "A", dailySendCap: 50000, uniqueUsersCap: 100000, frequencyCap: { maxSends: 3, period: "week" } },
      { name: "A", dailySendCap: 60000, uniqueUsersCap: 100000, frequencyCap: { maxSends: 3, period: "week" } },
    );
    expect(agentPatch).toEqual({ dailySendCap: 60000 });
    expect(schedulingPut).toBeNull();
  });

  it("routes scheduling fields to schedulingPut", () => {
    const { agentPatch, schedulingPut } = diffAgentSettings(
      { frequencyCap: { maxSends: 3, period: "week" } },
      { frequencyCap: { maxSends: 5, period: "week" } },
    );
    expect(agentPatch).toBeNull();
    expect(schedulingPut).toEqual({ frequencyCap: { maxSends: 5, period: "week" } });
  });

  it("deep-compares JSON fields (segmentTargeting, quietHours) instead of reference-comparing", () => {
    const { agentPatch } = diffAgentSettings(
      { segmentTargeting: { includes: ["a"], excludes: [] } },
      { segmentTargeting: { includes: ["a"], excludes: [] } },
    );
    expect(agentPatch).toBeNull();
  });

  it("treats null vs value as a change", () => {
    const { agentPatch } = diffAgentSettings({ uniqueUsersCap: null }, { uniqueUsersCap: 5000 });
    expect(agentPatch).toEqual({ uniqueUsersCap: 5000 });
  });
});
