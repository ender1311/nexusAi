import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { LibraryPicker, type LibraryDraftMessage } from "@/components/agents/library-picker";

const EMAIL_LIBRARY = {
  data: [
    {
      category: "giving",
      subcategory: "recurring-ask",
      variants: [
        { id: "v1", name: "Reach the world", subject: "Give monthly", body: "Body 1", cta: "Give", deeplink: "https://www.bible.com/give", category: "giving", subcategory: "recurring-ask" },
        { id: "v2", name: "195 countries", subject: "Reach 195 countries", body: "Body 2", category: "giving", subcategory: "recurring-ask" },
      ],
    },
    {
      category: "onboarding",
      subcategory: null,
      variants: [
        { id: "v3", name: "Welcome", subject: "Welcome to YouVersion", body: "Body 3", category: "onboarding", subcategory: null },
      ],
    },
  ],
};

beforeEach(() => {
  globalThis.fetch = (async (url: string | URL) => {
    const u = String(url);
    if (u.includes("/api/email-library")) {
      return new Response(JSON.stringify(EMAIL_LIBRARY), { status: 200 });
    }
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  }) as typeof fetch;
});

afterEach(() => cleanup());

describe("LibraryPicker", () => {
  it("loads the channel's library and renders categories + variant previews", async () => {
    render(<LibraryPicker channel="email" onAddToDraft={() => {}} />);
    // category buttons humanized from slugs
    expect(await screen.findByRole("button", { name: "Giving" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Onboarding" })).toBeDefined();
    // first category's variants show, with the email subject as the snippet
    expect(await screen.findByText("Reach the world")).toBeDefined();
    expect(screen.getByText("Give monthly")).toBeDefined();
  });

  it("commits the selected variants as a draft message with sourceTemplateId + channel", async () => {
    let committed: LibraryDraftMessage | null = null;
    render(<LibraryPicker channel="email" onAddToDraft={(m) => { committed = m; }} />);

    fireEvent.click(await screen.findByText("Reach the world"));

    const addBtn = await screen.findByRole("button", { name: /add message/i });
    await waitFor(() => expect((addBtn as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(addBtn);

    expect(committed).not.toBeNull();
    const msg = committed as unknown as LibraryDraftMessage;
    expect(msg.channel).toBe("email");
    expect(msg.variants).toHaveLength(1);
    expect(msg.variants[0]!.sourceTemplateId).toBe("v1");
    expect(msg.variants[0]!.subject).toBe("Give monthly");
    expect(msg.variants[0]!.body).toBe("Body 1");
    expect(msg.name.length).toBeGreaterThan(0);
  });

  it("switches categories and shows that category's variants", async () => {
    render(<LibraryPicker channel="email" onAddToDraft={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Onboarding" }));
    expect(await screen.findByText("Welcome")).toBeDefined();
    // first-category variant no longer shown
    expect(screen.queryByText("Reach the world")).toBeNull();
  });

  it("requires at least one selection before Add Message is enabled", async () => {
    render(<LibraryPicker channel="email" onAddToDraft={() => {}} />);
    await screen.findByText("Reach the world");
    const addBtn = screen.getByRole("button", { name: /add message/i });
    expect((addBtn as HTMLButtonElement).disabled).toBe(true);
  });
});
