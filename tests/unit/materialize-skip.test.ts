import { describe, it, expect } from "bun:test";
import { shouldSkipMaterialization, INGEST_MARGIN_MS } from "@/lib/segments/materialize-skip";

const T0 = new Date("2026-06-10T12:00:00.000Z"); // materializedAt baseline

describe("shouldSkipMaterialization", () => {
  it("never skips a never-materialized segment (materializedAt null)", () => {
    expect(
      shouldSkipMaterialization({
        materializedAt: null,
        updatedAt: new Date(T0.getTime() - 86_400_000),
        lastUserIngestAt: new Date(T0.getTime() - 86_400_000),
      }),
    ).toBe(false);
  });

  it("never skips when the rule was edited after the last materialization", () => {
    expect(
      shouldSkipMaterialization({
        materializedAt: T0,
        updatedAt: new Date(T0.getTime() + 1_000), // rule edited after run
        lastUserIngestAt: new Date(T0.getTime() - 3_600_000),
      }),
    ).toBe(false);
  });

  it("never skips when user ingest happened after the last materialization", () => {
    expect(
      shouldSkipMaterialization({
        materializedAt: T0,
        updatedAt: new Date(T0.getTime() - 3_600_000),
        lastUserIngestAt: new Date(T0.getTime() + 1_000),
      }),
    ).toBe(false);
  });

  it("never skips when ingest is inside the safety margin (throttled marker may hide writes)", () => {
    expect(
      shouldSkipMaterialization({
        materializedAt: T0,
        updatedAt: new Date(T0.getTime() - 3_600_000),
        lastUserIngestAt: new Date(T0.getTime() - INGEST_MARGIN_MS + 1), // 1ms inside margin
      }),
    ).toBe(false);
  });

  it("skips when ingest marker is exactly at the margin boundary", () => {
    expect(
      shouldSkipMaterialization({
        materializedAt: T0,
        updatedAt: new Date(T0.getTime() - 3_600_000),
        lastUserIngestAt: new Date(T0.getTime() - INGEST_MARGIN_MS),
      }),
    ).toBe(true);
  });

  it("skips when both rule and ingest are safely older than the last materialization", () => {
    expect(
      shouldSkipMaterialization({
        materializedAt: T0,
        updatedAt: new Date(T0.getTime() - 3_600_000),
        lastUserIngestAt: new Date(T0.getTime() - 4 * 3_600_000),
      }),
    ).toBe(true);
  });

  it("allows updatedAt exactly equal to materializedAt (unchanged rule) to skip", () => {
    expect(
      shouldSkipMaterialization({
        materializedAt: T0,
        updatedAt: T0,
        lastUserIngestAt: new Date(T0.getTime() - 4 * 3_600_000),
      }),
    ).toBe(true);
  });

  it("exports the 2-minute margin (twice the marker throttle)", () => {
    expect(INGEST_MARGIN_MS).toBe(120_000);
  });
});
