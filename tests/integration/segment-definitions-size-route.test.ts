import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { truncateAll } from "../helpers/db";
import { buildRequest } from "../helpers/request";
import { createUser } from "../helpers/builders";
import { POST } from "@/app/api/segment-definitions/size/route";

beforeEach(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });

describe("POST /api/segments/size", () => {
  it("returns an exact count for a valid rule", async () => {
    await createUser("u1", { funnelStage: "wau" });
    await createUser("u2", { funnelStage: "mau" });
    const body = { mode: "exact", rule: { kind: "group", join: "AND", children: [{ kind: "condition", fieldId: "funnelStage", operator: "in", value: ["wau"] }] } };
    const res = await POST(buildRequest("POST", body));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.count).toBe(1);
    expect(json.data.mode).toBe("exact");
  });

  it("returns an estimate for mode=estimate", async () => {
    await createUser("u1");
    const body = { mode: "estimate", rule: { kind: "group", join: "AND", children: [] } };
    const res = await POST(buildRequest("POST", body));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(typeof json.data.count).toBe("number");
  });

  it("400 on an invalid rule (unknown field)", async () => {
    const body = { mode: "exact", rule: { kind: "group", join: "AND", children: [{ kind: "condition", fieldId: "nope", operator: "eq", value: 1 }] } };
    const res = await POST(buildRequest("POST", body));
    expect(res.status).toBe(400);
  });

  it("400 on a bad mode", async () => {
    const body = { mode: "weird", rule: { kind: "group", join: "AND", children: [] } };
    const res = await POST(buildRequest("POST", body));
    expect(res.status).toBe(400);
  });
});
