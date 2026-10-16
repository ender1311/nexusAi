import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Walkthrough } from "@site/components/demo/walkthrough";

// happy-dom runs at about:blank, where replaceState does not change the URL, so
// record the calls instead.
let replaceState: ReturnType<typeof spyOn<History, "replaceState">>;
beforeEach(() => {
  replaceState = spyOn(history, "replaceState");
});
afterEach(() => {
  cleanup();
  replaceState.mockRestore();
});

describe("Walkthrough", () => {
  it("disables Back on step 1 and Next on step 6", () => {
    render(<Walkthrough initialStep={1} initialSource="contentful" />);
    expect((screen.getByRole("button", { name: "Back" }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    render(<Walkthrough initialStep={6} initialSource="contentful" />);
    expect((screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("switching to Braze Catalog on step 5 shows catalog_item_id; Contentful does not", () => {
    render(<Walkthrough initialStep={5} initialSource="contentful" />);
    expect(screen.queryByText(/catalog_item_id/)).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: /braze catalog/i }));
    expect(screen.getAllByText(/catalog_item_id/).length).toBeGreaterThan(0);
  });

  it("labels sample data on steps 1, 3 and 5", () => {
    for (const step of [1, 3, 5]) {
      render(<Walkthrough initialStep={step} initialSource="contentful" />);
      expect(screen.getAllByText(/^Sample/).length).toBeGreaterThan(0);
      cleanup();
    }
  });

  it("step 6 accumulates and resets", () => {
    render(<Walkthrough initialStep={6} initialSource="contentful" />);
    const before = screen.getByTestId("arm-alpha").textContent;
    fireEvent.click(screen.getByRole("button", { name: /user converted/i }));
    fireEvent.click(screen.getByRole("button", { name: /user converted/i }));
    expect(Number(screen.getByTestId("arm-alpha").textContent)).toBe(Number(before) + 2);
    fireEvent.click(screen.getByRole("button", { name: /reset/i }));
    expect(screen.getByTestId("arm-alpha").textContent).toBe(before);
  });

  it("arrow keys move the step, sync the URL, and the listener is removed on unmount", () => {
    const { unmount } = render(<Walkthrough initialStep={2} initialSource="sanity" />);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByRole("button", { name: "3 Content" }).getAttribute("aria-current")).toBe("step");
    expect(replaceState).toHaveBeenLastCalledWith(null, "", "?step=3&source=sanity");
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(replaceState).toHaveBeenLastCalledWith(null, "", "?step=2&source=sanity");
    unmount();
    const calls = replaceState.mock.calls.length;
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(replaceState.mock.calls.length).toBe(calls);
  });

  it("changing source resets step 6 stats to the new chosen arm", () => {
    render(<Walkthrough initialStep={4} initialSource="contentful" />);
    fireEvent.click(screen.getByRole("button", { name: "6 Learn" }));
    fireEvent.click(screen.getByRole("button", { name: /user converted/i }));
    fireEvent.click(screen.getByRole("button", { name: "5 Braze" }));
    fireEvent.click(screen.getByRole("radio", { name: /sanity/i }));
    fireEvent.click(screen.getByRole("button", { name: "6 Learn" }));
    const alpha = Number(screen.getByTestId("arm-alpha").textContent);
    fireEvent.click(screen.getByRole("button", { name: /reset/i }));
    expect(Number(screen.getByTestId("arm-alpha").textContent)).toBe(alpha);
  });

  it("Pick again changes the seed without breaking step 5", () => {
    render(<Walkthrough initialStep={4} initialSource="contentful" />);
    fireEvent.click(screen.getByRole("button", { name: /pick again/i }));
    expect(screen.getAllByText("Chosen").length).toBe(1);
    expect(screen.getByText(/users like this one/)).toBeTruthy();
  });
});
