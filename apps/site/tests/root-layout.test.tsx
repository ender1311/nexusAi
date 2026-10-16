import { describe, expect, it, mock } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("../brand/active-fonts.generated", () => ({ activeFontVariables: "" }));
mock.module("../app/globals.css", () => ({}));
const { default: RootLayout, metadata } = await import("../app/layout");

describe("root layout", () => {
  it("ships only the active brand's tokens and its identity in metadata", () => {
    const html = renderToStaticMarkup(<RootLayout><p>hi</p></RootLayout>);
    expect(html).toContain('data-brand="midnight"');
    expect(html).toContain('[data-brand="midnight"] {');
    expect(html).not.toContain('[data-brand="editorial"]');
    expect(html).not.toContain('[data-brand="human-hand"]');
    expect(metadata.openGraph?.description).toMatch(/picks the right message/);
  });
});
