import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { truncateAll, prisma } from "../helpers/db";
import {
  USER_INGEST_MARKER_KEY,
  MARKER_THROTTLE_MS,
  bumpUserIngestMarker,
  readUserIngestMarker,
} from "@/lib/segments/ingest-marker";

beforeEach(async () => {
  await truncateAll();
});

afterEach(async () => {
  await truncateAll();
});

describe("bumpUserIngestMarker", () => {
  it("creates the AppSetting row when absent", async () => {
    const now = new Date("2026-06-10T12:00:00.000Z");
    await bumpUserIngestMarker(now);

    const row = await prisma.appSetting.findUnique({ where: { key: USER_INGEST_MARKER_KEY } });
    expect(row?.value).toBe(now.toISOString());
  });

  it("skips the write when the stored value is younger than the throttle", async () => {
    const t0 = new Date("2026-06-10T12:00:00.000Z");
    await bumpUserIngestMarker(t0);

    const t1 = new Date(t0.getTime() + MARKER_THROTTLE_MS - 1_000); // 59s later
    await bumpUserIngestMarker(t1);

    const row = await prisma.appSetting.findUnique({ where: { key: USER_INGEST_MARKER_KEY } });
    expect(row?.value).toBe(t0.toISOString()); // unchanged
  });

  it("writes when the stored value is older than the throttle", async () => {
    const t0 = new Date("2026-06-10T12:00:00.000Z");
    await bumpUserIngestMarker(t0);

    const t1 = new Date(t0.getTime() + MARKER_THROTTLE_MS + 1_000); // 61s later
    await bumpUserIngestMarker(t1);

    const row = await prisma.appSetting.findUnique({ where: { key: USER_INGEST_MARKER_KEY } });
    expect(row?.value).toBe(t1.toISOString());
  });

  it("overwrites an unparseable stored value", async () => {
    await prisma.appSetting.create({ data: { key: USER_INGEST_MARKER_KEY, value: "not-a-date" } });
    const now = new Date("2026-06-10T12:00:00.000Z");
    await bumpUserIngestMarker(now);

    const row = await prisma.appSetting.findUnique({ where: { key: USER_INGEST_MARKER_KEY } });
    expect(row?.value).toBe(now.toISOString());
  });
});

describe("readUserIngestMarker", () => {
  it("returns the stored timestamp when present and valid", async () => {
    const t0 = new Date("2026-06-10T08:00:00.000Z");
    await prisma.appSetting.create({ data: { key: USER_INGEST_MARKER_KEY, value: t0.toISOString() } });

    const result = await readUserIngestMarker(new Date("2026-06-10T12:00:00.000Z"));
    expect(result.toISOString()).toBe(t0.toISOString());
  });

  it("fails open to `now` when the row is missing", async () => {
    const now = new Date("2026-06-10T12:00:00.000Z");
    const result = await readUserIngestMarker(now);
    expect(result.toISOString()).toBe(now.toISOString());
  });

  it("fails open to `now` when the stored value is unparseable", async () => {
    await prisma.appSetting.create({ data: { key: USER_INGEST_MARKER_KEY, value: "garbage" } });
    const now = new Date("2026-06-10T12:00:00.000Z");
    const result = await readUserIngestMarker(now);
    expect(result.toISOString()).toBe(now.toISOString());
  });
});
