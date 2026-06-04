import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll } from "../helpers/db";
import { buildRequest } from "../helpers/request";

const { GET, POST } = await import("@/app/api/demo/groups/route");
const { DELETE } = await import("@/app/api/demo/groups/[id]/route");

beforeEach(async () => {
  await truncateAll();
});

afterEach(async () => {
  await truncateAll();
});

describe("GET /api/demo/groups", () => {
  it("returns an empty array when no groups exist", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([]);
  });
});

describe("POST /api/demo/groups — validation", () => {
  it("returns 400 when name is missing", async () => {
    const req = buildRequest("POST", { userIds: ["1"] }) as NextRequest;
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(await res.json()).toHaveProperty("error");
  });

  it("returns 400 when userIds is empty", async () => {
    const req = buildRequest("POST", { name: "Empty", userIds: [] }) as NextRequest;
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(await res.json()).toHaveProperty("error");
  });
});

describe("POST /api/demo/groups — create and upsert", () => {
  it("creates a group and returns it via GET", async () => {
    const req = buildRequest("POST", { name: "VIPs", userIds: ["1", "2"] }) as NextRequest;
    const res = await POST(req);
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data.name).toBe("VIPs");
    expect(data.userIds).toEqual(["1", "2"]);

    const listRes = await GET();
    const list = await listRes.json();
    expect(list.data).toHaveLength(1);
    expect(list.data[0].name).toBe("VIPs");
    expect(list.data[0].userIds).toEqual(["1", "2"]);
  });

  it("upserts by name — POSTing the same name updates userIds instead of duplicating", async () => {
    const first = buildRequest("POST", { name: "Team", userIds: ["1"] }) as NextRequest;
    await POST(first);
    const second = buildRequest("POST", { name: "Team", userIds: ["1", "2", "3"] }) as NextRequest;
    const res = await POST(second);
    expect(res.status).toBe(201);

    const listRes = await GET();
    const list = await listRes.json();
    expect(list.data).toHaveLength(1);
    expect(list.data[0].userIds).toEqual(["1", "2", "3"]);
  });
});

describe("DELETE /api/demo/groups/[id]", () => {
  it("removes a group by id", async () => {
    const createRes = await POST(
      buildRequest("POST", { name: "Doomed", userIds: ["1"] }) as NextRequest
    );
    const { data } = await createRes.json();

    const delRes = await DELETE(buildRequest("DELETE") as NextRequest, {
      params: Promise.resolve({ id: data.id }),
    });
    expect(delRes.status).toBe(200);

    const listRes = await GET();
    const list = await listRes.json();
    expect(list.data).toEqual([]);
  });

  it("returns 404 when the id does not exist", async () => {
    const delRes = await DELETE(buildRequest("DELETE") as NextRequest, {
      params: Promise.resolve({ id: "grp_nonexistent" }),
    });
    expect(delRes.status).toBe(404);
    expect(await delRes.json()).toHaveProperty("error");
  });
});
