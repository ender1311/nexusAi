import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import DemoPage from "../app/demo/page";

afterEach(cleanup);

describe("DemoPage (server component)", () => {
  it("renders the step and source from the URL, not a blank shell", async () => {
    render(await DemoPage({ searchParams: Promise.resolve({ step: "3", source: "sanity" }) }));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/full loop/i);
    expect(screen.getByRole("button", { name: "3 Content" }).getAttribute("aria-current")).toBe("step");
    expect(screen.getByRole("radio", { name: "Sanity (roadmap)" }).getAttribute("aria-checked")).toBe("true");
  });

  it("with no params renders step 1 (sample data labelled)", async () => {
    render(await DemoPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("button", { name: "1 Hightouch" }).getAttribute("aria-current")).toBe("step");
    expect(screen.getAllByText(/^Sample/).length).toBeGreaterThan(0);
  });
});
