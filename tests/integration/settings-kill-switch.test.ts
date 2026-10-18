import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { prisma, truncateAll } from "../helpers/db";
import { buildRequest } from "../helpers/request";

import { POST } from "@/app/api/settings/route";

beforeEach(async () => {
  await truncateAll();
});

afterEach(async () => {
  await truncateAll();
});

// The kill switch is written by KillSwitchToggle via POST /api/settings and read
// server-side straight from AppSetting (cron/select-and-send, getCachedKillSwitchSetting).
// GET /api/settings deliberately does not return it: since 59c5584 GET only exposes
// a client-readable allowlist, and no client reads the kill switch back. So the
// round trip is POST → the AppSetting row the send path reads.
async function readKillSwitch(): Promise<string | undefined> {
  const row = await prisma.appSetting.findUnique({ where: { key: "global_sending_paused" } });
  return row?.value;
}

describe("global_sending_paused kill switch round-trip", () => {
  it("round-trips global_sending_paused through POST to the setting the send path reads", async () => {
    const postRes = await POST(buildRequest("POST", { global_sending_paused: "true" }) as NextRequest);
    expect(postRes.status).toBe(200);
    expect(await readKillSwitch()).toBe("true");

    // overwrite back to "false"
    const postRes2 = await POST(buildRequest("POST", { global_sending_paused: "false" }) as NextRequest);
    expect(postRes2.status).toBe(200);
    expect(await readKillSwitch()).toBe("false");
  });
});
