import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { truncateAll, prisma } from "../helpers/db";
import { buildRequest } from "../helpers/request";
import { createUser } from "../helpers/builders";
import { POST } from "@/app/api/segment-definitions/[id]/refresh-size/route";

const wauRule = { kind: "group", join: "AND", children: [{ kind: "condition", fieldId: "funnelStage", operator: "in", value: ["wau"] }] };

beforeEach(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });

describe("POST /api/segment-definitions/[id]/refresh-size", () => {
  it("computes the exact count and persists it on the Segment row", async () => {
    await createUser("u1", { funnelStage: "wau" });
    await createUser("u2", { funnelStage: "wau" });
    await createUser("u3", { funnelStage: "mau" });
    const seg = await prisma.segment.create({ data: { name: "WAU", rule: wauRule } });

    const res = await POST(buildRequest("POST"), { params: Promise.resolve({ id: seg.id }) });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.count).toBe(2);
    expect(json.data.timedOut).toBe(false);
    expect(typeof json.data.computedAt).toBe("string");

    const after = await prisma.segment.findUnique({ where: { id: seg.id } });
    expect(after?.sizeExact).toBe(2);
    expect(after?.sizeComputedAt).not.toBeNull();
  });

  it("returns 404 when the segment does not exist", async () => {
    const res = await POST(buildRequest("POST"), { params: Promise.resolve({ id: "missing" }) });
    expect(res.status).toBe(404);
  });

  it("returns 400 when the stored rule is corrupt", async () => {
    const seg = await prisma.segment.create({ data: { name: "Bad", rule: { junk: true } } });
    const res = await POST(buildRequest("POST"), { params: Promise.resolve({ id: seg.id }) });
    expect(res.status).toBe(400);
  });
});
