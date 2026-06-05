import { describe, expect, it } from "bun:test";
import { deriveRoleFlags } from "@/lib/auth";

describe("deriveRoleFlags", () => {
  it("flags admin", () => {
    const f = deriveRoleFlags(["admin"]);
    expect(f).toEqual({ isAdmin: true, isCopywriter: false, canManageLibrary: true });
  });
  it("flags copywriter as library manager but not admin", () => {
    const f = deriveRoleFlags(["copywriter"]);
    expect(f).toEqual({ isAdmin: false, isCopywriter: true, canManageLibrary: true });
  });
  it("treats unknown/empty roles as no access", () => {
    expect(deriveRoleFlags(undefined)).toEqual({ isAdmin: false, isCopywriter: false, canManageLibrary: false });
    expect(deriveRoleFlags([])).toEqual({ isAdmin: false, isCopywriter: false, canManageLibrary: false });
    expect(deriveRoleFlags(["viewer"])).toEqual({ isAdmin: false, isCopywriter: false, canManageLibrary: false });
  });
  it("admin who is also copywriter still manages library", () => {
    expect(deriveRoleFlags(["admin", "copywriter"]).canManageLibrary).toBe(true);
  });
});
