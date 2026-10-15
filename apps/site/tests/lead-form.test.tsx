import { afterEach, describe, expect, it, mock } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LeadForm } from "@site/components/lead-form";
import { publicConfig } from "@site/lib/public-config";

const originalFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

function fill() {
  fireEvent.change(screen.getByLabelText("Work email"), { target: { value: "ana@acme.io" } });
  fireEvent.change(screen.getByLabelText("Company"), { target: { value: "Acme" } });
  fireEvent.change(screen.getByLabelText("Use case to pilot"), { target: { value: "Win back trials" } });
}

describe("LeadForm", () => {
  it("disables submit while pending and shows Calendly on success", async () => {
    let resolve!: (r: Response) => void;
    globalThis.fetch = mock(() => new Promise<Response>((r) => { resolve = r; })) as unknown as typeof fetch;
    render(<LeadForm />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: /become a design partner/i }));
    expect((screen.getByRole("button", { name: /sending/i }) as HTMLButtonElement).disabled).toBe(true);
    resolve(new Response(JSON.stringify({ data: { ok: true } }), { status: 201 }));
    await waitFor(() => expect(screen.getByTitle("Book a call")).toBeTruthy());
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("shows the server error and keeps the form", async () => {
    globalThis.fetch = mock(async () => new Response(JSON.stringify({ error: "Too many requests. Try again later." }), { status: 429 })) as unknown as typeof fetch;
    render(<LeadForm />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: /become a design partner/i }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Too many requests"));
    expect(screen.queryByRole("link", { name: /book a call directly/i })).toBeNull();
  });

  it("offers a direct booking link when the server fails", async () => {
    globalThis.fetch = mock(async () => new Response(JSON.stringify({ error: "Something went wrong. Please try again." }), { status: 500 })) as unknown as typeof fetch;
    render(<LeadForm />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: /become a design partner/i }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Something went wrong"));
    const link = screen.getByRole("link", { name: /or book a call directly/i }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe(publicConfig.calendlyUrl);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("offers a direct booking link on a network error", async () => {
    globalThis.fetch = mock(async () => { throw new TypeError("Failed to fetch"); }) as unknown as typeof fetch;
    render(<LeadForm />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: /become a design partner/i }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Network error"));
    expect(screen.getByRole("link", { name: /or book a call directly/i })).toBeTruthy();
  });

  it("names the honeypot nx_hp and explains how lead data is used", () => {
    const { container } = render(<LeadForm />);
    expect(container.querySelector('input[name="nx_hp"]')).toBeTruthy();
    expect(container.querySelector('input[name="website"]')).toBeNull();
    expect(container.textContent).toContain("we store a hashed IP, never the raw address");
  });
});
