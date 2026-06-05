import { describe, expect, it } from "bun:test";
import { parseAudiencePayload } from "@/app/api/ingest/audiences/parse-payload";

describe("parseAudiencePayload", () => {
  it("accepts legacy cohort_changes with user_ids", () => {
    const result = parseAudiencePayload({
      cohort_id: "cohort_a",
      cohort_changes: [{ user_ids: ["u1", "u2"] }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload).toEqual({
      cohortId: "cohort_a",
      externalIds: ["u1", "u2"],
      brazeIds: [],
    });
  });

  it("accepts singular user_id inside cohort_changes", () => {
    const result = parseAudiencePayload({
      cohort_id: "cohort_a",
      cohort_changes: [{ user_id: "u1" }, { user_id: "u2" }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.externalIds).toEqual(["u1", "u2"]);
  });

  it("accepts top-level user_id for Hightouch column mapping", () => {
    const result = parseAudiencePayload({
      cohort_id: "cohort_a",
      user_id: "123456",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload).toEqual({
      cohortId: "cohort_a",
      externalIds: ["123456"],
      brazeIds: [],
    });
  });

  it("accepts users array with user_id rows", () => {
    const result = parseAudiencePayload({
      cohort_id: "cohort_a",
      users: [{ user_id: "u1" }, { user_id: "u2" }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.externalIds).toEqual(["u1", "u2"]);
  });

  it("accepts rows array with user_id", () => {
    const result = parseAudiencePayload({
      cohort_id: "cohort_a",
      rows: [{ user_id: "u1" }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.externalIds).toEqual(["u1"]);
  });

  it("accepts root array of user_id rows with cohort_id on each row", () => {
    const result = parseAudiencePayload([
      { cohort_id: "cohort_a", user_id: "u1" },
      { cohort_id: "cohort_a", user_id: "u2" },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.cohortId).toBe("cohort_a");
    expect(result.payload.externalIds).toEqual(["u1", "u2"]);
  });

  it("maps external_user_id alias to external ids", () => {
    const result = parseAudiencePayload({
      cohort_id: "cohort_a",
      external_user_id: "u2",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.externalIds).toEqual(["u2"]);
  });

  it("maps braze_user_id_latest alias to braze ids", () => {
    const result = parseAudiencePayload({
      cohort_id: "cohort_a",
      braze_user_id_latest: "braze_1",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.brazeIds).toEqual(["braze_1"]);
  });

  it("returns 400 when cohort_id is missing", () => {
    const result = parseAudiencePayload({ user_id: "u1" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("cohort_id");
  });

  it("returns 400 when payload has cohort_id but no user ids", () => {
    const result = parseAudiencePayload({ cohort_id: "cohort_a" });
    expect(result.ok).toBe(false);
  });
});
