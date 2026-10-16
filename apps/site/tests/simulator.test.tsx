import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { Simulator } from "@site/components/simulator/simulator";
import { chartThemes } from "@site/brand/chart-theme";
import { midnight } from "@site/brand/presets/midnight";

afterEach(cleanup);

describe("Simulator", () => {
  it("defaults to the live stack: Hightouch in, Braze out", () => {
    render(<Simulator chartThemes={chartThemes(midnight)} product="Nexus" />);
    expect((screen.getByLabelText("Data source") as HTMLSelectElement).value).toBe("hightouch");
    expect((screen.getByLabelText("Sender") as HTMLSelectElement).value).toBe("braze");
  });

  it("offers Run as the primary action before the first run", () => {
    render(<Simulator chartThemes={chartThemes(midnight)} product="Nexus" />);
    expect(screen.getByRole("button", { name: "Run" })).toBeTruthy();
  });
});
