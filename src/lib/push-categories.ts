// Canonical push copy category catalogue — the single source of truth for which
// categories and subcategories exist in the push library. Every consumer (library
// API validation, library UI ordering/filters, the template form sheet, and the
// agent message pickers) derives from this list so the catalogue cannot drift.
//
// Ordering here is the canonical display order. Subcategory values match what is
// stored on MessageVariant rows in the DB; `guided-scripture` intentionally has no
// subcategories (its variants carry a null subcategory).

export type PushSubcategory = { value: string; label: string };
export type PushCategory = { value: string; label: string; subcategories: PushSubcategory[] };

export const PUSH_CATEGORIES: PushCategory[] = [
  {
    value: "reader",
    label: "Reader",
    subcategories: [
      { value: "open-bible", label: "Open Bible" },
      { value: "audio-bible", label: "Audio Bible" },
      { value: "specific-verse", label: "Specific Verse" },
    ],
  },
  {
    value: "votd",
    label: "VOTD",
    subcategories: [
      { value: "votd-page", label: "Verse of the Day" },
      { value: "todays-story", label: "Today's Story" },
    ],
  },
  {
    value: "plans",
    label: "Plans",
    subcategories: [
      { value: "find-plans", label: "Find Plans" },
      { value: "my-plans", label: "My Plans" },
      { value: "saved-plans", label: "Saved Plans" },
    ],
  },
  {
    value: "guided-scripture",
    label: "Guided Scripture",
    subcategories: [],
  },
  {
    value: "guided-prayer",
    label: "Guided Prayer",
    subcategories: [
      { value: "guided-prayer", label: "Guided Prayer" },
      { value: "prayer-list", label: "Prayer List" },
    ],
  },
  {
    value: "giving",
    label: "Giving",
    subcategories: [
      { value: "monthly-appeal", label: "Monthly Appeal" },
      { value: "giving-tuesday", label: "Giving Tuesday" },
      { value: "eoy", label: "End of Year" },
      { value: "matching-gift", label: "Matching Gift" },
      { value: "recurring-gift", label: "Recurring Gift" },
      { value: "sower-generosity", label: "Sower Generosity" },
      { value: "impact-story", label: "Impact Story" },
      { value: "prayer", label: "Prayer" },
      { value: "thank-you-followup", label: "Thank You Follow-up" },
      { value: "dynamic-handle", label: "Dynamic Handle" },
    ],
  },
];

// Ordered list of category values (also serves as canonical sort order).
export const PUSH_CATEGORY_VALUES: string[] = PUSH_CATEGORIES.map((c) => c.value);

// category value → ordered subcategory value list (slug form, for the form sheet).
export const PUSH_SUBCATEGORIES: Record<string, string[]> = Object.fromEntries(
  PUSH_CATEGORIES.map((c) => [c.value, c.subcategories.map((s) => s.value)]),
);
