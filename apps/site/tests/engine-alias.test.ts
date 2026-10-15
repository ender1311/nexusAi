import { describe, expect, it } from "bun:test";
import { ThompsonSampling } from "@engine/thompson-sampling";
import { LinUCB } from "@engine/linucb";

describe("engine alias", () => {
  it("imports the real engine classes", () => {
    expect(typeof new ThompsonSampling().select).toBe("function");
    expect(new LinUCB().initialArm(3).aInv).toHaveLength(9);
  });
});
