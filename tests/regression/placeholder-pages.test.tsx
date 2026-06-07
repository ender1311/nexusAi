import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import SearchPage from "@/app/audience/search/page";
import SegmentsPage from "@/app/audience/segments/page";
import SizesPage from "@/app/audience/sizes/page";
import EmailLibraryPage from "@/app/email-library/page";

// Regression: nav skeleton (sub-project A) ships placeholder routes so the new
// Audience + Content nav entries don't 404 before B/C land.

describe("placeholder pages", () => {
  it("each renders a Coming soon panel without throwing", () => {
    for (const Page of [SearchPage, SegmentsPage, SizesPage, EmailLibraryPage]) {
      const html = renderToStaticMarkup(<Page />);
      expect(html).toContain("Coming soon");
    }
  });
});
