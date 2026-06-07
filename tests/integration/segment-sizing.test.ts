import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { truncateAll } from "../helpers/db";
import { createUser } from "../helpers/builders";
import { compileSegmentRule } from "@/lib/segments/compile-sql";
import { estimateSegmentSize, exactSegmentSize } from "@/lib/segments/sizing";
import type { SegmentRule } from "@/types/segment";

const rule = (children: unknown[]): SegmentRule => ({ kind: "group", join: "AND", children } as SegmentRule);

beforeEach(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });

describe("segment sizing", () => {
  it("exact COUNT matches the number of users that satisfy the rule", async () => {
    await createUser("u1", { funnelStage: "wau", totalDecisions: 10 });
    await createUser("u2", { funnelStage: "wau", totalDecisions: 1 });
    await createUser("u3", { funnelStage: "mau", totalDecisions: 10 });
    const where = compileSegmentRule(rule([
      { kind: "condition", fieldId: "funnelStage", operator: "in", value: ["wau"] },
      { kind: "condition", fieldId: "totalDecisions", operator: "gte", value: 5 },
    ]));
    const res = await exactSegmentSize(where);
    expect(res.timedOut).toBe(false);
    expect(res.count).toBe(1); // only u1
  });

  it("empty rule (TRUE) counts everyone", async () => {
    await createUser("u1");
    await createUser("u2");
    const res = await exactSegmentSize(compileSegmentRule(rule([])));
    expect(res.count).toBe(2);
  });

  it("estimate returns a non-negative integer", async () => {
    await createUser("u1", { funnelStage: "wau" });
    const where = compileSegmentRule(rule([{ kind: "condition", fieldId: "funnelStage", operator: "in", value: ["wau"] }]));
    const est = await estimateSegmentSize(where);
    expect(Number.isInteger(est)).toBe(true);
    expect(est).toBeGreaterThanOrEqual(0);
  });

  it("attr-based exact count works", async () => {
    await createUser("u1", { attributes: { country_latest: "US" } });
    await createUser("u2", { attributes: { country_latest: "GB" } });
    const where = compileSegmentRule(rule([{ kind: "condition", fieldId: "country_latest", operator: "eq", value: "US" }]));
    const res = await exactSegmentSize(where);
    expect(res.count).toBe(1);
  });
});
