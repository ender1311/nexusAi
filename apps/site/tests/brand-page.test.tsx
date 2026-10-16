import { afterEach, describe, expect, it, mock } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { BRANDS } from "@site/brand/presets";

// next/font loaders only run under the Next compiler; the page just needs the class names.
mock.module("../brand/preview-fonts.generated", () => ({ previewFontVariables: "" }));
const { default: BrandPage, metadata } = await import("../app/brand/page");

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
    // The layout ships only the active brand's tokens, so the preview injects every preset's.
    const css = container.querySelector("style")?.textContent ?? "";
    for (const id of Object.keys(BRANDS)) expect(css).toContain(`[data-brand="${id}"] {`);
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});
