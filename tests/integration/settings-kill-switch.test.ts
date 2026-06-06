import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { truncateAll } from "../helpers/db";
import { buildRequest } from "../helpers/request";

import { GET, POST } from "@/app/api/settings/route";

beforeEach(async () => {
  await truncateAll();
});

afterEach(async () => {
  await truncateAll();
});

describe("global_sending_paused kill switch round-trip", () => {
  it("round-trips global_sending_paused through POST then GET", async () => {
    const postRes = await POST(buildRequest("POST", { global_sending_paused: "true" }) as NextRequest);
    expect(postRes.status).toBe(200);

    const getRes = await GET();
    const body = await getRes.json();
    expect(body.global_sending_paused).toBe("true");

    // overwrite back to "false"
    await POST(buildRequest("POST", { global_sending_paused: "false" }) as NextRequest);
    const getRes2 = await GET();
    const body2 = await getRes2.json();
    expect(body2.global_sending_paused).toBe("false");
  });
});
