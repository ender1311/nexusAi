import { afterEach, describe, expect, it, mock, beforeEach } from "bun:test";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { SyncNameEdit } from "@/components/data-ingest/sync-name-edit";

const fetchCalls: { url: string; method: string; body: string | null }[] = [];

beforeEach(() => {
  fetchCalls.length = 0;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    fetchCalls.push({ url: String(url), method: init?.method ?? "GET", body: (init?.body as string) ?? null });
    return new Response(JSON.stringify({ data: {} }), { status: 200 });
  }) as typeof fetch;
});
afterEach(() => cleanup());

describe("SyncNameEdit", () => {
  it("shows the current name and reveals an input on edit", () => {
    render(<SyncNameEdit syncId="123" currentName="Push Opens" defaultName="Opens Wau" />);
    expect(screen.getByText("Push Opens")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /edit name/i }));
    expect(screen.getByDisplayValue("Push Opens")).toBeInTheDocument();
  });

  it("PUTs the trimmed new name on save", async () => {
    render(<SyncNameEdit syncId="123" currentName="Old" defaultName="Old" />);
    fireEvent.click(screen.getByRole("button", { name: /edit name/i }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "  New Name  " } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(fetchCalls.length).toBe(1));
    expect(fetchCalls[0]!.url).toBe("/api/hightouch/syncs/123/name");
    expect(fetchCalls[0]!.method).toBe("PUT");
    expect(JSON.parse(fetchCalls[0]!.body!)).toEqual({ displayName: "New Name" });
  });

  it("DELETEs (reset) when the input is cleared and saved", async () => {
    render(<SyncNameEdit syncId="123" currentName="Push Opens" defaultName="Opens Wau" />);
    fireEvent.click(screen.getByRole("button", { name: /edit name/i }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(fetchCalls.length).toBe(1));
    expect(fetchCalls[0]!.method).toBe("DELETE");
  });
});
