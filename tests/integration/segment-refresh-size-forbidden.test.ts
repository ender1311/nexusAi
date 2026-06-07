import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

// Override the global admin mock from tests/setup/bun.ts: a session with no roles.
mock.module("@workos-inc/authkit-nextjs", () => ({
  withAuth: async () => ({ user: { id: "u", email: "u@youversion.com", firstName: "U", lastName: "Ser" }, roles: [] }),
  signOut: () => Promise.resolve(),
}));

const { truncateAll, prisma } = await import("../helpers/db");
const { buildRequest } = await import("../helpers/request");
const { POST } = await import("@/app/api/segment-definitions/[id]/refresh-size/route");

const wauRule = { kind: "group", join: "AND", children: [{ kind: "condition", fieldId: "funnelStage", operator: "in", value: ["wau"] }] };

beforeEach(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });

describe("POST refresh-size — auth", () => {
  it("returns 403 for a non-admin session", async () => {
    const seg = await prisma.segment.create({ data: { name: "WAU", rule: wauRule } });
    const res = await POST(buildRequest("POST"), { params: Promise.resolve({ id: seg.id }) });
    expect(res.status).toBe(403);
  });
});
