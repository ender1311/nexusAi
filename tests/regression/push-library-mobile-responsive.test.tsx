import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  PushLibraryClient,
  type TemplateGroup,
} from "@/components/push-library/push-library-client";
import { TemplateCard } from "@/components/push-library/template-card";
import { AddLanguageDrawer } from "@/components/push-library/add-language-drawer";

// Regression: the push library UI overflowed horizontally on mobile viewports.
//   1. push-library-client table view wrapped a fixed-column <table> in
//      `overflow-hidden`, so on a narrow screen the right-hand columns (Title,
//      Actions) were clipped with no way to scroll to them. The table view is
//      the DEFAULT view, so mobile users hit this immediately. Fix: the wrapper
//      uses `overflow-x-auto` and the table carries `min-w-[640px]` so columns
//      keep their width and the user can scroll horizontally.
//   2. add-language-drawer hard-coded `w-[640px]` with no mobile fallback, so
//      the sheet was 640px wide even on a 375px screen. Fix: `w-full` on mobile,
//      `sm:w-[640px]` from the sm breakpoint up.
//   3. template-card badge row was `flex shrink-0` with no wrap, so a card with
//      Incomplete + language + subcategory badges could crowd/overflow the name
//      in the narrowest grid column. Fix: `flex-wrap` (justify-end) lets badges
//      wrap to a second line.

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const originalFetch = globalThis.fetch;

beforeAll(() => {
  // useTaxonomy() fires a relative-URL fetch on mount; neutralize it so the
  // tests don't depend on a server (and don't emit unhandled rejections).
  globalThis.fetch = (async () =>
    ({ ok: true, json: async () => ({ data: [] }) }) as unknown as Response) as unknown as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function findByClass(scope: ParentNode, ...substrings: string[]): HTMLElement | null {
  for (const el of Array.from(scope.querySelectorAll<HTMLElement>("*"))) {
    const cls = el.getAttribute("class") ?? "";
    if (substrings.every((s) => cls.includes(s))) return el;
  }
  return null;
}

describe("push library mobile responsiveness", () => {
  it("table view scrolls horizontally instead of clipping fixed-width columns", () => {
    const groups: TemplateGroup[] = [
      {
        category: "encouragement",
        subcategory: "reference",
        variants: [
          {
            id: "v1",
            name: "A — Consistency",
            title: "Keep going",
            body: "You showed up today.",
            deeplink: "youversion://bible",
            cta: null,
            category: "encouragement",
            subcategory: "reference",
            iconImageUrl: null,
            languages: [],
          },
        ],
      },
    ];

    act(() => {
      root.render(<PushLibraryClient groups={groups} canManageLibrary={true} />);
    });

    const table = container.querySelector("table");
    expect(table).not.toBeNull();

    // The table must keep its fixed-column width so columns don't squash.
    expect(table!.className).toContain("min-w-[640px]");

    // The wrapper must allow horizontal scroll — NOT clip the overflow.
    const wrapper = table!.parentElement as HTMLElement;
    expect(wrapper.className).toContain("overflow-x-auto");
    expect(wrapper.className).not.toContain("overflow-hidden");
  });

  it("add-language drawer is full width on mobile and fixed from sm up", () => {
    act(() => {
      root.render(
        <AddLanguageDrawer
          campaign="resurrection-push"
          enVerseRefs={[]}
          onClose={() => {}}
          onSaved={() => {}}
        />,
      );
    });

    // Sheet content renders in a portal on document.body, not inside container.
    const sheet = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(sheet).not.toBeNull();
    expect(sheet!.className).toContain("w-full");
    expect(sheet!.className).toContain("sm:w-[640px]");
  });

  it("template card badges wrap instead of crowding the name", () => {
    act(() => {
      root.render(
        <TemplateCard
          variant={{
            id: "v1",
            name: "A long template name that competes for horizontal space",
            title: "Title",
            body: "Body",
            deeplink: null,
            cta: null,
            category: "encouragement",
            subcategory: "reference",
            iconImageUrl: null,
            languages: ["es", "pt"],
          }}
          isAdmin={false}
        />,
      );
    });

    // The badge container sits to the right of the name; it must be allowed to
    // wrap rather than force the row wider than the card.
    const badgeRow = findByClass(container, "shrink-0", "flex-wrap");
    expect(badgeRow).not.toBeNull();
  });
});
