import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import BrandPage, { metadata } from "../app/brand/page";
import { BRANDS } from "@site/brand/presets";

const original = process.env.VERCEL_ENV;
afterEach(() => {
  cleanup();
  if (original === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = original;
});

describe("/nexus/brand preview page", () => {
  it("is notFound in production", () => {
    process.env.VERCEL_ENV = "production";
    let digest = "";
    try { BrandPage(); } catch (e) { digest = String((e as { digest?: string }).digest ?? e); }
    expect(digest).toContain("404");
  });

  it("shows a sample for every preset, each under its data-brand scope, and is not indexed", () => {
    process.env.VERCEL_ENV = "preview";
    const { container } = render(BrandPage());
    for (const id of Object.keys(BRANDS)) expect(container.querySelector(`[data-brand="${id}"]`)).toBeTruthy();
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});
