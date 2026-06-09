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

  // Audit fix #1: the PUT name-clash guard used to query UserSegment by segmentName
  // with no source filter. Once the materialize cron writes source='rule' rows under
  // the segment's own name, an unfiltered findFirst matched them and 409'd every
  // subsequent edit — making rule-segments permanently uneditable.
  it("PUT does not 409 against the segment's own materialized rule rows", async () => {
    const seg = await prisma.segment.create({ data: { name: "rule-seg", rule: validRule } });
    await createUserSegment("u1", "rule-seg", "rule");
    await createUserSegment("u2", "rule-seg", "rule");
    const res = await putSegment(buildRequest("PUT", { name: "rule-seg", rule: validRule }), { params: Promise.resolve({ id: seg.id }) });
    expect(res.status).toBe(200);
  });

  it("PUT still 409s when the name collides with a hightouch-imported segment", async () => {
    const seg = await prisma.segment.create({ data: { name: "orig", rule: validRule } });
    await createUserSegment("u1", "all-givers", "hightouch");
    const res = await putSegment(buildRequest("PUT", { name: "all-givers", rule: validRule }), { params: Promise.resolve({ id: seg.id }) });
    expect(res.status).toBe(409);
  });

  // Audit fix #8: a changed rule means a different membership, so the cached exact
  // size must be invalidated; a name/description-only edit must keep it.
  it("PUT clears cached size when the rule changes, keeps it when unchanged", async () => {
    const seg = await prisma.segment.create({
      data: { name: "sz", rule: validRule, sizeExact: 42, sizeComputedAt: new Date() },
    });

    const r1 = await putSegment(buildRequest("PUT", { name: "sz2", rule: validRule }), { params: Promise.resolve({ id: seg.id }) });
    expect(r1.status).toBe(200);
    const after1 = await prisma.segment.findUniqueOrThrow({ where: { id: seg.id } });
    expect(after1.sizeExact).toBe(42);
    expect(after1.sizeComputedAt).not.toBeNull();

    const newRule = { kind: "group", join: "AND", children: [{ kind: "condition", fieldId: "funnelStage", operator: "in", value: ["mau"] }] };
    const r2 = await putSegment(buildRequest("PUT", { name: "sz2", rule: newRule }), { params: Promise.resolve({ id: seg.id }) });
    expect(r2.status).toBe(200);
    const after2 = await prisma.segment.findUniqueOrThrow({ where: { id: seg.id } });
    expect(after2.sizeExact).toBeNull();
    expect(after2.sizeComputedAt).toBeNull();
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
