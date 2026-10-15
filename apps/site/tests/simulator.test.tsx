import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { Simulator } from "@site/components/simulator/simulator";

afterEach(cleanup);

describe("Simulator", () => {
  it("defaults to the live stack: Hightouch in, Braze out", () => {
    render(<Simulator />);
    expect((screen.getByLabelText("Data source") as HTMLSelectElement).value).toBe("hightouch");
    expect((screen.getByLabelText("Sender") as HTMLSelectElement).value).toBe("braze");
  });

  it("offers Run as the primary action before the first run", () => {
    render(<Simulator />);
    expect(screen.getByRole("button", { name: "Run" })).toBeTruthy();
  });
});
