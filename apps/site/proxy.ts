import { NextResponse } from "next/server";

// Pass-through. Turbopack, with the root widened to the repo root for the @engine alias,
// otherwise picks up the main app's ../../src/middleware.ts (WorkOS auth) for this public site.
export function proxy() {
  return NextResponse.next();
}

export const config = { matcher: [] };
