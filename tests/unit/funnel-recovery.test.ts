import { describe, expect, it } from "bun:test";
import { isRecovery, recoveryRank } from "@/lib/engine/funnel-recovery";

describe("isRecovery", () => {
  // lapsed_mau recovers to any active stage (rank >= 1)
  it("lapsed_mau → mau/wau/dau4 are recoveries", () => {
    expect(isRecovery("lapsed_mau", "mau")).toBe(true);
    expect(isRecovery("lapsed_mau", "wau")).toBe(true);
    expect(isRecovery("lapsed_mau", "dau4")).toBe(true);
  });

  // lapsed_wau requires rank >= 2 (wau or dau4)
  it("lapsed_wau → wau/dau4 recover; → mau does NOT", () => {
    expect(isRecovery("lapsed_wau", "wau")).toBe(true);
    expect(isRecovery("lapsed_wau", "dau4")).toBe(true);
    expect(isRecovery("lapsed_wau", "mau")).toBe(false);
  });

  // lapsed_dau4 requires rank >= 3 (dau4 only)
  it("lapsed_dau4 → dau4 recovers; → mau/wau do NOT", () => {
    expect(isRecovery("lapsed_dau4", "dau4")).toBe(true);
    expect(isRecovery("lapsed_dau4", "mau")).toBe(false);
    expect(isRecovery("lapsed_dau4", "wau")).toBe(false);
  });

  it("new is never a recovery target", () => {
    expect(isRecovery("lapsed_mau", "new")).toBe(false);
    expect(isRecovery("lapsed_wau", "new")).toBe(false);
    expect(isRecovery("lapsed_dau4", "new")).toBe(false);
  });

  it("lapsed → lapsed is never a recovery", () => {
    expect(isRecovery("lapsed_mau", "lapsed_wau")).toBe(false);
    expect(isRecovery("lapsed_dau4", "lapsed_dau4")).toBe(false);
  });

  it("non-lapsed from is never a recovery", () => {
    expect(isRecovery("mau", "dau4")).toBe(false);
    expect(isRecovery("new", "dau4")).toBe(false);
    expect(isRecovery("wau", "dau4")).toBe(false);
  });

  it("unknown/garbage stages do not throw and are not recoveries", () => {
    expect(isRecovery("", "")).toBe(false);
    expect(isRecovery("lapsed_mau", "garbage")).toBe(false);
    expect(isRecovery("garbage", "dau4")).toBe(false);
  });
});

describe("recoveryRank", () => {
  it("returns the destination active rank (mau=1, wau=2, dau4=3)", () => {
    expect(recoveryRank("mau")).toBe(1);
    expect(recoveryRank("wau")).toBe(2);
    expect(recoveryRank("dau4")).toBe(3);
  });

  it("returns 0 for non-active stages", () => {
    expect(recoveryRank("new")).toBe(0);
    expect(recoveryRank("lapsed_mau")).toBe(0);
    expect(recoveryRank("garbage")).toBe(0);
  });
});
