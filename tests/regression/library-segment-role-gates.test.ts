// Regression: the four non-push library POST routes and the segment-definitions
// item GET must enforce their role gate. Bug: those POSTs shipped without
// requireLibraryEditor (their DELETE handlers + push-library POST had it), and
// the item GET returned the full row (targeting rule + createdBy) to any session
// while PUT/DELETE and the list endpoint were gated/stripped. Any logged-in
// (no-role) staff could create active variants or read targeting rules.
//
// These assert the gate fires (403) BEFORE any DB access, so no test DB needed.

import { describe, it, expect, mock } from "bun:test";
import { NextRequest, NextResponse } from "next/server";

mock.module("@/lib/auth", () => ({
  requireLibraryEditor: async () => NextResponse.json({ error: "Forbidden" }, { status: 403 }),
  requireAdmin: async () => NextResponse.json({ error: "Forbidden" }, { status: 403 }),
}));

import { POST as contentCardPost } from "@/app/api/content-card-library/route";
import { POST as emailPost } from "@/app/api/email-library/route";
import { POST as modalIamPost } from "@/app/api/modal-iam-library/route";
import { POST as slideupPost } from "@/app/api/slideup-library/route";
import { GET as segmentItemGet } from "@/app/api/segment-definitions/[id]/route";

function postReq(path: string): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "x", category: "y", subcategory: null,
      title: "t", subject: "s", body: "b", htmlBody: "<p>h</p>",
    }),
  });
}

describe("library POST + segment GET role gates", () => {
  it("content-card-library POST denies a non-editor with 403", async () => {
    expect((await contentCardPost(postReq("/api/content-card-library"))).status).toBe(403);
  });

  it("email-library POST denies a non-editor with 403", async () => {
    expect((await emailPost(postReq("/api/email-library"))).status).toBe(403);
  });

  it("modal-iam-library POST denies a non-editor with 403", async () => {
    expect((await modalIamPost(postReq("/api/modal-iam-library"))).status).toBe(403);
  });

  it("slideup-library POST denies a non-editor with 403", async () => {
    expect((await slideupPost(postReq("/api/slideup-library"))).status).toBe(403);
  });

  it("segment-definitions item GET denies a non-admin with 403", async () => {
    const res = await segmentItemGet(
      new Request("http://localhost/api/segment-definitions/seg_1"),
      { params: Promise.resolve({ id: "seg_1" }) },
    );
    expect(res.status).toBe(403);
  });
});
