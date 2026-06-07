import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import SearchPage from "@/app/audience/search/page";

describe("Audience › Search Users page", () => {
  it("renders the page header and search affordance, not the Coming soon placeholder", () => {
    const html = renderToStaticMarkup(<SearchPage />);
    expect(html).toContain("Search Users");
    expect(html).not.toContain("Coming soon");
  });
});
