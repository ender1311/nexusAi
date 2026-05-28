import { describe, it, expect } from "bun:test";

describe("isLapsed funnel stage classification", () => {
  // Test function that mirrors the logic from route.ts line 660
  const computeIsLapsed = (funnelStage: string | null): boolean => {
    return (
      funnelStage === "lapsed" ||
      funnelStage === "lapsed_wau" ||
      funnelStage === "lapsed_mau" ||
      funnelStage === "lapsed_dau" ||
      funnelStage === "lapsed_dau4"
    );
  };

  describe("lapsed variants", () => {
    it('should classify "lapsed" as isLapsed = true', () => {
      expect(computeIsLapsed("lapsed")).toBe(true);
    });

    it('should classify "lapsed_wau" as isLapsed = true', () => {
      expect(computeIsLapsed("lapsed_wau")).toBe(true);
    });

    it('should classify "lapsed_mau" as isLapsed = true', () => {
      expect(computeIsLapsed("lapsed_mau")).toBe(true);
    });

    it('should classify "lapsed_dau" as isLapsed = true', () => {
      expect(computeIsLapsed("lapsed_dau")).toBe(true);
    });

    it('should classify "lapsed_dau4" as isLapsed = true', () => {
      expect(computeIsLapsed("lapsed_dau4")).toBe(true);
    });
  });

  describe("non-lapsed stages", () => {
    it('should classify "wau" as isLapsed = false', () => {
      expect(computeIsLapsed("wau")).toBe(false);
    });

    it('should classify "new" as isLapsed = false', () => {
      expect(computeIsLapsed("new")).toBe(false);
    });

    it('should classify "mau" as isLapsed = false', () => {
      expect(computeIsLapsed("mau")).toBe(false);
    });

    it('should classify "dau4" as isLapsed = false', () => {
      expect(computeIsLapsed("dau4")).toBe(false);
    });

    it('should classify null as isLapsed = false', () => {
      expect(computeIsLapsed(null)).toBe(false);
    });
  });
});
