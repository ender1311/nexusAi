// Regression (spec 2026-06-08-sync-display-name-rename): a custom display name is
// display-only. Triggering must always call the Hightouch client with the raw
// sync id from the route param, never the renamed display string. This pins the
// invariant so a future change can't leak the display name into the trigger path.

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { truncateAll, prisma } from "../helpers/db";

const mockAuth = { roles: ["admin"] as string[] };
mock.module("@workos-inc/authkit-nextjs", () => ({
  withAuth: () =>
    Promise.resolve({
      user: { id: "u1", email: "test@youversion.com", firstName: null, lastName: null },
      roles: mockAuth.roles, sessionId: "s", accessToken: "t",
    }),
  signOut: async () => {},
}));

const triggerCalls: string[] = [];
mock.module("@/lib/hightouch/client", () => ({
  createHightouchClient: () => ({
    triggerSync: async (id: string) => { triggerCalls.push(id); return { id: "run1" }; },
  }),
}));

const { POST: triggerSync } = await import("@/app/api/hightouch/syncs/[id]/trigger/route");

beforeEach(async () => { await truncateAll(); triggerCalls.length = 0; });
afterEach(async () => { await truncateAll(); });

describe("renaming a sync never changes the id used to trigger it", () => {
  it("triggers with the raw sync id even when a display override exists", async () => {
    await prisma.syncNameOverride.create({ data: { syncId: "2770929", displayName: "Push Opens" } });

    const req = new Request("http://localhost/api/hightouch/syncs/2770929/trigger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const res = await triggerSync(req as never, { params: Promise.resolve({ id: "2770929" }) });
    expect(res.status).toBe(200);
    expect(triggerCalls).toEqual(["2770929"]);
  });
});
