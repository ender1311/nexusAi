import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { truncateAll, prisma } from "../helpers/db";
import { buildRequest } from "../helpers/request";
import { createUserSegment } from "../helpers/builders";
import { GET as listSegments, POST as createSegment } from "@/app/api/segment-definitions/route";
import { GET as getSegment, PUT as putSegment, DELETE as deleteSegment } from "@/app/api/segment-definitions/[id]/route";

const validRule = { kind: "group", join: "AND", children: [{ kind: "condition", fieldId: "funnelStage", operator: "in", value: ["wau"] }] };

beforeEach(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });

describe("Segment CRUD", () => {
  it("POST creates a segment and GET list returns it", async () => {
    const res = await createSegment(buildRequest("POST", { name: "WAU power users", description: "d", rule: validRule }));
    const created = await res.json();
    expect(res.status).toBe(201);
    expect(created.data.name).toBe("WAU power users");

    const listRes = await listSegments();
    const list = await listRes.json();
    expect(list.data).toHaveLength(1);
    expect(list.data[0].name).toBe("WAU power users");
  });

  it("POST 400 on invalid rule", async () => {
    const res = await createSegment(buildRequest("POST", { name: "Bad", rule: { kind: "group", join: "AND", children: [{ kind: "condition", fieldId: "nope", operator: "eq", value: 1 }] } }));
    expect(res.status).toBe(400);
  });

  it("POST 400 on empty name", async () => {
    const res = await createSegment(buildRequest("POST", { name: "  ", rule: validRule }));
    expect(res.status).toBe(400);
  });

  it("POST 409 on duplicate Segment name", async () => {
    await createSegment(buildRequest("POST", { name: "Dup", rule: validRule }));
    const res = await createSegment(buildRequest("POST", { name: "Dup", rule: validRule }));
    expect(res.status).toBe(409);
  });

  it("POST 409 when name collides with an existing UserSegment name", async () => {
    await createUserSegment("u1", "all-givers");
    const res = await createSegment(buildRequest("POST", { name: "all-givers", rule: validRule }));
    expect(res.status).toBe(409);
  });

  it("GET [id] returns the parsed rule; 404 when missing", async () => {
    const seg = await prisma.segment.create({ data: { name: "X", rule: validRule } });
    const okRes = await getSegment(buildRequest("GET"), { params: Promise.resolve({ id: seg.id }) });
    const okBody = await okRes.json();
    expect(okRes.status).toBe(200);
    expect(okBody.data.rule.children).toHaveLength(1);

    const missRes = await getSegment(buildRequest("GET"), { params: Promise.resolve({ id: "nope" }) });
    expect(missRes.status).toBe(404);
  });

  it("PUT updates name + rule", async () => {
    const seg = await prisma.segment.create({ data: { name: "Old", rule: validRule } });
    const res = await putSegment(buildRequest("PUT", { name: "New", rule: validRule }), { params: Promise.resolve({ id: seg.id }) });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.name).toBe("New");
  });

  it("DELETE removes the segment; 404 when missing", async () => {
    const seg = await prisma.segment.create({ data: { name: "Doomed", rule: validRule } });
    const okRes = await deleteSegment(buildRequest("DELETE"), { params: Promise.resolve({ id: seg.id }) });
    expect(okRes.status).toBe(200);
    expect(await prisma.segment.count()).toBe(0);

    const missRes = await deleteSegment(buildRequest("DELETE"), { params: Promise.resolve({ id: "nope" }) });
    expect(missRes.status).toBe(404);
  });
});
