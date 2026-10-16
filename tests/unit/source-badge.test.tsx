import { afterEach, describe, expect, it } from "bun:test";
import { render, screen, cleanup } from "@testing-library/react";
import { SourceBadge, contentfulEditUrl, isSyncedSource } from "@/components/content/source-badge";

afterEach(() => cleanup());

describe("SourceBadge", () => {
  it("renders nothing for nexus-library", () => {
    const { container } = render(<SourceBadge source="nexus-library" externalRef={null} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders the Contentful pill with the synced title", () => {
    render(<SourceBadge source="contentful" externalRef="e1" />);
    const pill = screen.getByText("Contentful");
    expect(pill.getAttribute("title")).toBe("Synced — edit at the source");
  });

  it("labels the other sources", () => {
    for (const [source, label] of [["sanity", "Sanity"], ["generic-json", "JSON"], ["braze-catalog", "Braze Catalog"]] as const) {
      render(<SourceBadge source={source} externalRef="x" />);
      expect(screen.getByText(label)).toBeTruthy();
      cleanup();
    }
  });

  it("renders a link when editUrl is set", () => {
    render(<SourceBadge source="contentful" externalRef="e1" editUrl="https://app.contentful.com/spaces/sp1/entries/e1" />);
    const link = screen.getByText("Contentful").closest("a");
    expect(link?.getAttribute("href")).toBe("https://app.contentful.com/spaces/sp1/entries/e1");
  });

  it("builds the Contentful edit URL", () => {
    expect(contentfulEditUrl("sp1", "e1")).toBe("https://app.contentful.com/spaces/sp1/entries/e1");
  });

  it("treats only non-native sources as synced", () => {
    expect(isSyncedSource("nexus-library")).toBe(false);
    expect(isSyncedSource(undefined)).toBe(false);
    expect(isSyncedSource("sanity")).toBe(true);
  });
});
