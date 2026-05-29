import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EventPushForm } from "@/components/data-ingest/event-push-form";

// Regression: the form built occurredAtISO via new Date(occurredAt).toISOString()
// with no validity check. A cleared/invalid datetime-local value produced an
// invalid Date, and .toISOString() throws "RangeError: Invalid time value",
// crashing the submit handler before the fetch. The fix validates the parsed
// date and surfaces a friendly error instead of throwing — and crucially does
// so BEFORE any network request fires.

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let fetchCalls: number;
const originalFetch = globalThis.fetch;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    return new Response(JSON.stringify({ data: { processed: 0, matched: 0 } }), {
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

function setValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function submit() {
  const form = container.querySelector("form")!;
  act(() => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

describe("EventPushForm date validity", () => {
  it("rejects an invalid Occurred At without throwing or calling fetch", () => {
    act(() => {
      root.render(<EventPushForm />);
    });

    const userId = container.querySelector<HTMLInputElement>("#pe-user-id")!;
    const occurredAt = container.querySelector<HTMLInputElement>("#pe-occurred-at")!;

    act(() => {
      setValue(userId, "user-123");
      setValue(occurredAt, ""); // cleared datetime-local → invalid Date
    });

    submit();

    expect(container.textContent).toContain("Occurred At is not a valid date.");
    expect(fetchCalls).toBe(0);
  });

  it("submits when Occurred At is valid", async () => {
    act(() => {
      root.render(<EventPushForm />);
    });

    const userId = container.querySelector<HTMLInputElement>("#pe-user-id")!;
    act(() => {
      setValue(userId, "user-123");
      // The default occurredAt is already a valid local datetime value.
    });

    submit();
    // Let the async submit handler resolve the mocked fetch.
    await act(async () => {
      await Promise.resolve();
    });

    expect(fetchCalls).toBe(1);
    expect(container.textContent).not.toContain("not a valid date");
  });
});
