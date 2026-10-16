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
    render(<Walkthrough initialStep={1} initialSource="contentful" product="Nexus" />);
    expect((screen.getByRole("button", { name: "Back" }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    render(<Walkthrough initialStep={6} initialSource="contentful" product="Nexus" />);
    expect((screen.getByRole("button", { name: "Next" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("switching to Braze Catalog on step 5 shows catalog_item_id; Contentful does not", () => {
    render(<Walkthrough initialStep={5} initialSource="contentful" product="Nexus" />);
    expect(screen.queryByText(/catalog_item_id/)).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: /braze catalog/i }));
    expect(screen.getAllByText(/catalog_item_id/).length).toBeGreaterThan(0);
  });

  it("labels sample data on steps 1, 3 and 5", () => {
    for (const step of [1, 3, 5]) {
      render(<Walkthrough initialStep={step} initialSource="contentful" product="Nexus" />);
      expect(screen.getAllByText(/^Sample/).length).toBeGreaterThan(0);
      cleanup();
    }
  });

  it("step 6 accumulates and resets", () => {
    render(<Walkthrough initialStep={6} initialSource="contentful" product="Nexus" />);
    const before = screen.getByTestId("arm-alpha").textContent;
    fireEvent.click(screen.getByRole("button", { name: /user converted/i }));
    fireEvent.click(screen.getByRole("button", { name: /user converted/i }));
    expect(Number(screen.getByTestId("arm-alpha").textContent)).toBe(Number(before) + 2);
    fireEvent.click(screen.getByRole("button", { name: /reset/i }));
    expect(screen.getByTestId("arm-alpha").textContent).toBe(before);
  });

  it("arrow keys move the step, sync the URL, and the listener is removed on unmount", () => {
    const { unmount } = render(<Walkthrough initialStep={2} initialSource="sanity" product="Nexus" />);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByRole("button", { name: "3 Content" }).getAttribute("aria-current")).toBe("step");
    expect(replaceState).toHaveBeenLastCalledWith(null, "", `${window.location.pathname}?step=3&source=sanity`);
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(replaceState).toHaveBeenLastCalledWith(null, "", `${window.location.pathname}?step=2&source=sanity`);
    unmount();
    const calls = replaceState.mock.calls.length;
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(replaceState.mock.calls.length).toBe(calls);
  });

  it("changing source resets step 6 stats to the new chosen arm", () => {
    render(<Walkthrough initialStep={4} initialSource="contentful" product="Nexus" />);
    fireEvent.click(screen.getByRole("button", { name: "6 Learn" }));
    fireEvent.click(screen.getByRole("button", { name: /user converted/i }));
    fireEvent.click(screen.getByRole("button", { name: "5 Braze" }));
    fireEvent.click(screen.getByRole("radio", { name: /sanity/i }));
    fireEvent.click(screen.getByRole("button", { name: "6 Learn" }));
    const alpha = Number(screen.getByTestId("arm-alpha").textContent);
    fireEvent.click(screen.getByRole("button", { name: /reset/i }));
    expect(Number(screen.getByTestId("arm-alpha").textContent)).toBe(alpha);
  });

  it("Pick again changes the chosen item (seed 42 picks breathing, 43 picks sleep)", () => {
    const chosenRow = () => document.querySelector("tr[aria-current=true]")!.textContent;
    render(<Walkthrough initialStep={4} initialSource="contentful" product="Nexus" />);
    const before = chosenRow();
    fireEvent.click(screen.getByRole("button", { name: /pick again/i }));
    expect(chosenRow()).not.toBe(before);
    expect(screen.getAllByText("Chosen").length).toBe(1);
    expect(screen.getByText(/users like this one/)).toBeTruthy();
  });

  it("ignores arrow keys typed into an input", () => {
    render(<Walkthrough initialStep={2} initialSource="contentful" product="Nexus" />);
    const input = document.createElement("input");
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: "ArrowRight" });
    input.remove();
    expect(screen.getByRole("button", { name: "2 Features" }).getAttribute("aria-current")).toBe("step");
  });

  it("ArrowRight on a focused radio changes the source, not the step", () => {
    render(<Walkthrough initialStep={4} initialSource="contentful" product="Nexus" />);
    const radio = screen.getByRole("radio", { name: "Contentful (roadmap)" });
    radio.focus();
    fireEvent.keyDown(radio, { key: "ArrowRight" });
    expect(screen.getByRole("radio", { name: "Sanity (roadmap)" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("button", { name: "4 Decide" }).getAttribute("aria-current")).toBe("step");
  });

  it("radiogroup uses roving tabindex, wraps, and supports Home/End", () => {
    render(<Walkthrough initialStep={4} initialSource="contentful" product="Nexus" />);
    const radio = (name: string) => screen.getByRole("radio", { name }) as HTMLButtonElement;
    expect(radio("Contentful (roadmap)").tabIndex).toBe(0);
    expect(radio("Sanity (roadmap)").tabIndex).toBe(-1);
    fireEvent.keyDown(radio("Contentful (roadmap)"), { key: "ArrowLeft" });
    expect(radio("Nexus library").getAttribute("aria-checked")).toBe("true");
    expect(radio("Nexus library").tabIndex).toBe(0);
    expect(document.activeElement).toBe(radio("Nexus library"));
    fireEvent.keyDown(radio("Nexus library"), { key: "Home" });
    expect(radio("Contentful (roadmap)").getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(radio("Contentful (roadmap)"), { key: "End" });
    expect(radio("Nexus library").getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(radio("Nexus library"), { key: "ArrowDown" });
    expect(radio("Contentful (roadmap)").getAttribute("aria-checked")).toBe("true");
  });

  it("clicking the already-selected source keeps step 6 stats", () => {
    render(<Walkthrough initialStep={5} initialSource="contentful" product="Nexus" />);
    fireEvent.click(screen.getByRole("button", { name: "6 Learn" }));
    fireEvent.click(screen.getByRole("button", { name: /user converted/i }));
    const after = screen.getByTestId("arm-alpha").textContent;
    fireEvent.click(screen.getByRole("button", { name: "5 Braze" }));
    fireEvent.click(screen.getByRole("radio", { name: "Contentful (roadmap)" }));
    fireEvent.click(screen.getByRole("button", { name: "6 Learn" }));
    expect(screen.getByTestId("arm-alpha").textContent).toBe(after);
  });

  it("step 5 shows the catalog sentence only in reference mode", () => {
    render(<Walkthrough initialStep={5} initialSource="contentful" product="Nexus" />);
    expect(screen.queryByText(/Braze renders the catalog item Nexus picked/)).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: /braze catalog/i }));
    expect(screen.getByText(/Braze renders the catalog item Nexus picked/)).toBeTruthy();
  });

  it("steps 3, 4 and 5 show the roadmap note for roadmap sources only", () => {
    for (const step of [3, 4, 5]) {
      render(<Walkthrough initialStep={step} initialSource="contentful" product="Nexus" />);
      expect(screen.getByText(/Roadmap: the Contentful connector is being built/)).toBeTruthy();
      fireEvent.click(screen.getByRole("radio", { name: "Nexus library" }));
      expect(screen.queryByText(/Roadmap:/)).toBeNull();
      cleanup();
    }
  });

  it("step 5 reference sentence says (roadmap) and push explains the inline copy", () => {
    render(<Walkthrough initialStep={5} initialSource="braze-catalog" product="Nexus" />);
    expect(screen.getByText(/With the Braze Catalog connector \(roadmap\), Braze renders/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Push" }));
    expect(screen.getByText(/can't read a catalog, so the copy is sent inline/)).toBeTruthy();
  });

  it("Alt+ArrowRight on a focused radio does not change the source", () => {
    render(<Walkthrough initialStep={4} initialSource="contentful" product="Nexus" />);
    const radio = screen.getByRole("radio", { name: "Contentful (roadmap)" });
    radio.focus();
    fireEvent.keyDown(radio, { key: "ArrowRight", altKey: true });
    expect(radio.getAttribute("aria-checked")).toBe("true");
  });
});
