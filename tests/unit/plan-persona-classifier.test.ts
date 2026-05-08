import { describe, expect, it } from "bun:test";
import { classifyPersona, type BrazeAttributes } from "@/lib/engine/plan-persona-classifier";

const CURRENT_YEAR = 2026;
const PREV_YEAR = String(CURRENT_YEAR - 1);

/** Base "blank slate" attributes — triggers null fallback */
const blank: BrazeAttributes = {};

describe("classifyPersona", () => {
  // ─── Rule 1: Re-engager ────────────────────────────────────────────────────
  describe("Rule 1 — Re-engager (lapsed)", () => {
    it("returns Re-engager when lifetimeFinishes >= 2, yearCount = 0, planYear in past", () => {
      const result = classifyPersona(
        { plan_finish_lifetime_count: 2, plan_day_current_year_count: 0, plan_day_year: PREV_YEAR },
        [],
        CURRENT_YEAR,
      );
      expect(result).toBe("Re-engager");
    });

    it("returns Re-engager when planYear is null (never engaged this year)", () => {
      const result = classifyPersona(
        { plan_finish_lifetime_count: 3, plan_day_current_year_count: 0, plan_day_year: null },
        [],
        CURRENT_YEAR,
      );
      expect(result).toBe("Re-engager");
    });

    it("does NOT return Re-engager when user engaged this year (yearCount > 0)", () => {
      const result = classifyPersona(
        { plan_finish_lifetime_count: 3, plan_day_current_year_count: 5, plan_day_year: PREV_YEAR },
        [],
        CURRENT_YEAR,
      );
      expect(result).not.toBe("Re-engager");
    });

    it("does NOT return Re-engager when lifetimeFinishes < 2", () => {
      const result = classifyPersona(
        { plan_finish_lifetime_count: 1, plan_day_current_year_count: 0, plan_day_year: PREV_YEAR },
        [],
        CURRENT_YEAR,
      );
      expect(result).not.toBe("Re-engager");
    });

    it("does NOT return Re-engager when planYear equals current year", () => {
      const result = classifyPersona(
        { plan_finish_lifetime_count: 5, plan_day_current_year_count: 0, plan_day_year: String(CURRENT_YEAR) },
        [],
        CURRENT_YEAR,
      );
      expect(result).not.toBe("Re-engager");
    });
  });

  // ─── Rule 2: Parent ────────────────────────────────────────────────────────
  describe("Rule 2 — Parent (parenting collection)", () => {
    it("returns Parent when planPersonaTags includes Parent", () => {
      expect(classifyPersona(blank, ["Parent"])).toBe("Parent");
    });

    it("returns Parent even when Re-engager rule would fail (Parent is priority 2)", () => {
      // Re-engager requires lifetimeFinishes >= 2, yearCount = 0. Parent wins if those don't match.
      expect(classifyPersona({ plan_finish_lifetime_count: 0 }, ["Parent"])).toBe("Parent");
    });

    it("Re-engager beats Parent when both rules fire (priority 1 > 2)", () => {
      const result = classifyPersona(
        { plan_finish_lifetime_count: 3, plan_day_current_year_count: 0, plan_day_year: PREV_YEAR },
        ["Parent"],
        CURRENT_YEAR,
      );
      expect(result).toBe("Re-engager");
    });
  });

  // ─── Rule 3: Seeker ────────────────────────────────────────────────────────
  describe("Rule 3 — Seeker (new-to-faith tag)", () => {
    it("returns Seeker when tag present, low finishes, low yearCount", () => {
      expect(classifyPersona({ plan_finish_lifetime_count: 0, plan_day_current_year_count: 5 }, ["Seeker"])).toBe("Seeker");
    });

    it("does NOT return Seeker when lifetimeFinishes >= 2 (not new)", () => {
      const result = classifyPersona(
        { plan_finish_lifetime_count: 2, plan_day_current_year_count: 5 },
        ["Seeker"],
      );
      expect(result).not.toBe("Seeker");
    });

    it("does NOT return Seeker when yearCount >= 15 (too active)", () => {
      const result = classifyPersona(
        { plan_finish_lifetime_count: 0, plan_day_current_year_count: 15 },
        ["Seeker"],
      );
      expect(result).not.toBe("Seeker");
    });
  });

  // ─── Rule 4: Church-first ─────────────────────────────────────────────────
  describe("Rule 4 — Church-first (Life.Church publisher)", () => {
    it("returns Church-first for Life.Church publisher", () => {
      expect(classifyPersona({ plan_day_last_plan_publisher: "Life.Church" }, [])).toBe("Church-first");
    });

    it("is case-insensitive for publisher match", () => {
      expect(classifyPersona({ plan_day_last_plan_publisher: "LIFE.CHURCH" }, [])).toBe("Church-first");
    });

    it("does not match unrelated publisher", () => {
      const result = classifyPersona({ plan_day_last_plan_publisher: "YouVersion" }, []);
      expect(result).not.toBe("Church-first");
    });
  });

  // ─── Rule 5: Emotion-first ────────────────────────────────────────────────
  describe("Rule 5 — Emotion-first (prayer/scripture)", () => {
    it("returns Emotion-first when tag present and prayerYear >= 2", () => {
      expect(classifyPersona({ gp_current_year_count: 2, plan_day_current_year_count: 5 }, ["Emotion-first"])).toBe("Emotion-first");
    });

    it("returns Emotion-first when tag present and scriptureYear >= 2", () => {
      expect(classifyPersona({ gs_current_year_count: 2, plan_day_current_year_count: 5 }, ["Emotion-first"])).toBe("Emotion-first");
    });

    it("returns Emotion-first on behavior alone: prayerYear >= 5, yearCount < 20", () => {
      expect(classifyPersona({ gp_current_year_count: 5, plan_day_current_year_count: 10 }, [])).toBe("Emotion-first");
    });

    it("returns Emotion-first on behavior: scriptureYear >= 5, yearCount < 20", () => {
      expect(classifyPersona({ gs_current_year_count: 6, plan_day_current_year_count: 5 }, [])).toBe("Emotion-first");
    });

    it("does NOT return Emotion-first when yearCount >= 20 (high planner, not anxious)", () => {
      const result = classifyPersona(
        { gp_current_year_count: 6, plan_day_current_year_count: 20 },
        [],
      );
      expect(result).not.toBe("Emotion-first");
    });
  });

  // ─── Rule 6: Bible-first ──────────────────────────────────────────────────
  describe("Rule 6 — Bible-first (long plans, low prayer)", () => {
    it("returns Bible-first when tag present and prayerYear < 3", () => {
      expect(classifyPersona({ gp_current_year_count: 2 }, ["Bible-first"])).toBe("Bible-first");
    });

    it("returns Bible-first when planLength >= 90 and prayerYear < 3", () => {
      expect(classifyPersona({ plan_day_last_plan_length: 90, gp_current_year_count: 0 }, [])).toBe("Bible-first");
    });

    it("does NOT return Bible-first when prayerYear >= 3 (Emotion-first may apply)", () => {
      const result = classifyPersona({ plan_day_last_plan_length: 365, gp_current_year_count: 3 }, ["Bible-first"]);
      expect(result).not.toBe("Bible-first");
    });
  });

  // ─── Rule 7: Devotion-first ───────────────────────────────────────────────
  describe("Rule 7 — Devotion-first (deep study, high frequency)", () => {
    it("returns Devotion-first when tag present", () => {
      expect(classifyPersona(blank, ["Devotion-first"])).toBe("Devotion-first");
    });

    it("returns Devotion-first when yearCount >= 30 and lifetimeFinishes >= 3", () => {
      expect(classifyPersona(
        { plan_day_current_year_count: 30, plan_finish_lifetime_count: 3 },
        [],
      )).toBe("Devotion-first");
    });

    it("does NOT return Devotion-first when yearCount < 30", () => {
      const result = classifyPersona(
        { plan_day_current_year_count: 29, plan_finish_lifetime_count: 5 },
        [],
      );
      expect(result).not.toBe("Devotion-first");
    });
  });

  // ─── Rule 8: Social-first ─────────────────────────────────────────────────
  describe("Rule 8 — Social-first (young adults, badges)", () => {
    it("returns Social-first when tag present", () => {
      expect(classifyPersona(blank, ["Social-first"])).toBe("Social-first");
    });

    it("returns Social-first when badge_current_year_count >= 5", () => {
      expect(classifyPersona({ badge_current_year_count: 5 }, [])).toBe("Social-first");
    });

    it("does NOT return Social-first when badges < 5", () => {
      const result = classifyPersona({ badge_current_year_count: 4 }, []);
      expect(result).not.toBe("Social-first");
    });
  });

  // ─── Rule 9: Seeker fallback ──────────────────────────────────────────────
  describe("Rule 9 — Seeker fallback (new low-engagement user)", () => {
    it("returns Seeker for zero finishes, very low yearCount and monthCount", () => {
      expect(classifyPersona(
        { plan_finish_lifetime_count: 0, plan_day_current_year_count: 2, plan_day_current_month_count: 1 },
        [],
      )).toBe("Seeker");
    });

    it("does NOT hit Seeker fallback when yearCount >= 5", () => {
      const result = classifyPersona(
        { plan_finish_lifetime_count: 0, plan_day_current_year_count: 5, plan_day_current_month_count: 1 },
        [],
      );
      expect(result).not.toBe("Seeker");
    });

    it("does NOT hit Seeker fallback when monthCount >= 3", () => {
      const result = classifyPersona(
        { plan_finish_lifetime_count: 0, plan_day_current_year_count: 3, plan_day_current_month_count: 3 },
        [],
      );
      expect(result).not.toBe("Seeker");
    });
  });

  // ─── Rule 10: null (no signal) ────────────────────────────────────────────
  describe("null — insufficient signal", () => {
    it("returns null for completely blank attributes", () => {
      expect(classifyPersona(blank, [])).toBeNull();
    });

    it("returns null for moderate engagement with no distinctive tags or patterns", () => {
      expect(classifyPersona(
        { plan_day_current_year_count: 10, plan_finish_lifetime_count: 1 },
        [],
      )).toBeNull();
    });
  });

  // ─── Priority ordering ────────────────────────────────────────────────────
  describe("priority ordering", () => {
    it("Parent (2) beats Seeker (3) when both tags present", () => {
      expect(classifyPersona(
        { plan_finish_lifetime_count: 0, plan_day_current_year_count: 5 },
        ["Seeker", "Parent"],
      )).toBe("Parent");
    });

    it("currentYear defaults to current calendar year", () => {
      // With planYear = 2 years ago and no yearCount, Re-engager should fire with default year param
      const twoYearsAgo = String(new Date().getFullYear() - 2);
      const result = classifyPersona(
        { plan_finish_lifetime_count: 2, plan_day_current_year_count: 0, plan_day_year: twoYearsAgo },
        [],
        // no currentYear — uses default
      );
      expect(result).toBe("Re-engager");
    });
  });
});
