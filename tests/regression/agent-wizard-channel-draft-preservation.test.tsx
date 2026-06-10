import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

// Regression: switching channels on the wizard Messages step reset the draft
// to a single empty variant, silently discarding typed message name/body.
// Fixed 2026-06-10 by keeping one draft per channel.

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { AgentWizard } = await import("@/components/agents/agent-wizard");

let container: HTMLDivElement;
let root: Root;
const originalFetch = globalThis.fetch;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/segments")) {
      return new Response(
        JSON.stringify({ data: [{ name: "VIP", userCount: 1200, assignedTo: null }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (url.includes("/api/variants")) {
      // TemplatePicker expects a bare VariantWithMessage[] array.
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    // Anything else (templates/categories) — empty data is fine.
    return new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  globalThis.fetch = originalFetch;
});

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function typeInto(input: HTMLInputElement, next: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setValue.call(input, next);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function clickButtonByText(text: string) {
  const btn = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
    (b) => b.textContent?.trim() === text,
  )!;
  act(() => {
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

async function goToStep3() {
  act(() => {
    root.render(<AgentWizard personas={[]} />);
  });
  await flush();
  typeInto(
    container.querySelector<HTMLInputElement>('input[placeholder="e.g. Recommend Bible Plans"]')!,
    "My Agent",
  );
  clickButtonByText("Segment");
  const vipRow = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
    (b) => b.textContent?.includes("VIP"),
  )!;
  act(() => {
    vipRow.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  clickButtonByText("Next"); // -> step 2 (Goals)
  clickButtonByText("Next"); // -> step 3 (Messages)
  await flush();
}

describe("AgentWizard per-channel message drafts", () => {
  it("keeps an email draft intact across a switch to push and back", async () => {
    await goToStep3();

    clickButtonByText("EMAIL");
    typeInto(container.querySelector<HTMLInputElement>('input[placeholder="Message name"]')!, "Welcome email");
    typeInto(container.querySelector<HTMLInputElement>('input[placeholder="Body text"]')!, "Hello there");

    clickButtonByText("PUSH");
    await flush();
    clickButtonByText("EMAIL");
    await flush();

    expect(container.querySelector<HTMLInputElement>('input[placeholder="Message name"]')!.value).toBe("Welcome email");
    expect(container.querySelector<HTMLInputElement>('input[placeholder="Body text"]')!.value).toBe("Hello there");
  });

  // Regression: goNext()'s step-3 auto-commit only committed the ACTIVE channel's
  // draft, so an email draft typed before switching to PUSH was silently dropped
  // from the submitted agent. Fixed 2026-06-10 by committing all qualifying drafts.
  it("auto-commits a non-active email draft when clicking Next on step 3", async () => {
    await goToStep3();

    clickButtonByText("EMAIL");
    typeInto(container.querySelector<HTMLInputElement>('input[placeholder="Message name"]')!, "Welcome email");
    typeInto(container.querySelector<HTMLInputElement>('input[placeholder="Body text"]')!, "Hello there");

    // Switch back to PUSH so the email draft is no longer the active channel.
    clickButtonByText("PUSH");
    await flush();

    clickButtonByText("Next"); // -> step 4 (Scheduling); must auto-commit the email draft
    await flush();
    clickButtonByText("Next"); // -> step 5 (Review)
    await flush();

    // Review step renders "Messages (N)" and each committed message's name.
    expect(container.textContent).toContain("Messages (1)");
    expect(container.textContent).toContain("Welcome email");
  });
});
