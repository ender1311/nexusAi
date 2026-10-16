import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { activeBrand, resolveBrand } from "@site/brand/presets";

const original = process.env.NEXT_PUBLIC_BRAND;
afterEach(() => {
  if (original === undefined) delete process.env.NEXT_PUBLIC_BRAND;
  else process.env.NEXT_PUBLIC_BRAND = original;
});

describe("activeBrand", () => {
  it("defaults to midnight", () => {
    delete process.env.NEXT_PUBLIC_BRAND;
    expect(activeBrand().id).toBe("midnight");
  });

  it("honours NEXT_PUBLIC_BRAND", () => {
    process.env.NEXT_PUBLIC_BRAND = "editorial";
    expect(activeBrand().id).toBe("editorial");
    process.env.NEXT_PUBLIC_BRAND = "human-hand";
    expect(activeBrand().id).toBe("human-hand");
  });

  it("falls back to midnight with a warning for an unknown brand", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    expect(resolveBrand("neon-dreams").id).toBe("midnight");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("neon-dreams");
    warn.mockRestore();
  });

  it("does not warn when the variable is unset or blank", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    expect(resolveBrand(undefined).id).toBe("midnight");
    expect(resolveBrand("").id).toBe("midnight");
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("activeBrand in production", () => {
  const originalEnv = process.env.VERCEL_ENV;
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = originalEnv;
  });

  it("throws for an unknown brand so the production build fails", () => {
    process.env.VERCEL_ENV = "production";
    process.env.NEXT_PUBLIC_BRAND = "nope";
    expect(() => activeBrand()).toThrow(/nope/);
  });

  it("still resolves known and unset brands in production", () => {
    process.env.VERCEL_ENV = "production";
    process.env.NEXT_PUBLIC_BRAND = "editorial";
    expect(activeBrand().id).toBe("editorial");
    delete process.env.NEXT_PUBLIC_BRAND;
    expect(activeBrand().id).toBe("midnight");
  });
});
