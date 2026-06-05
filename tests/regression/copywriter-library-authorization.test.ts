// Regression: copywriter role must have full push-library edit parity with admin,
// and nothing outside it. Viewers (no role) must be denied. Guards the pure
// deriveRoleFlags mapping that requireLibraryEditor / getAuth depend on.
// Bug context: push-library overhaul (#206) — copywriter role added in WorkOS.

import { describe, it, expect } from "bun:test";
import { deriveRoleFlags, COPYWRITER_ROLE } from "@/lib/auth";

describe("copywriter library authorization", () => {
  it("admin can manage the library", () => {
    const flags = deriveRoleFlags(["admin"]);
    expect(flags.isAdmin).toBe(true);
    expect(flags.canManageLibrary).toBe(true);
  });

  it("copywriter can manage the library but is not admin", () => {
    const flags = deriveRoleFlags([COPYWRITER_ROLE]);
    expect(flags.isCopywriter).toBe(true);
    expect(flags.isAdmin).toBe(false);
    expect(flags.canManageLibrary).toBe(true);
  });

  it("a user with no roles cannot manage the library", () => {
    const flags = deriveRoleFlags([]);
    expect(flags.isAdmin).toBe(false);
    expect(flags.isCopywriter).toBe(false);
    expect(flags.canManageLibrary).toBe(false);
  });

  it("undefined roles cannot manage the library", () => {
    const flags = deriveRoleFlags(undefined);
    expect(flags.canManageLibrary).toBe(false);
  });
});
