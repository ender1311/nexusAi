// Canonical content card category catalogue — single source of truth for the
// content card library taxonomy. Mirrors email-categories.ts / push-categories.ts.

export type ContentCardSubcategory = { value: string; label: string };
export type ContentCardCategory = { value: string; label: string; subcategories: ContentCardSubcategory[] };

export const CONTENT_CARD_CATEGORIES: ContentCardCategory[] = [
  {
    value: "giving",
    label: "Giving",
    subcategories: [
      { value: "appeal", label: "Appeal" },
      { value: "giving-tuesday", label: "Giving Tuesday" },
      { value: "year-end", label: "Year-End" },
      { value: "thank-you", label: "Thank You" },
      { value: "impact-story", label: "Impact Story" },
    ],
  },
  {
    value: "bible-plans",
    label: "Bible Plans",
    subcategories: [
      { value: "featured-plans", label: "Featured Plans" },
      { value: "challenge", label: "Challenge" },
      { value: "seasonal-plans", label: "Seasonal Plans" },
    ],
  },
  {
    value: "guided-scripture",
    label: "Guided Scripture",
    subcategories: [
      { value: "guided-scripture", label: "Guided Scripture" },
    ],
  },
  {
    value: "prayer",
    label: "Prayer",
    subcategories: [
      { value: "prayer", label: "Prayer" },
      { value: "guided-prayer", label: "Guided Prayer" },
    ],
  },
  {
    value: "seasonal",
    label: "Seasonal",
    subcategories: [
      { value: "easter", label: "Easter" },
      { value: "christmas", label: "Christmas" },
      { value: "lent-advent", label: "Lent & Advent" },
    ],
  },
  {
    value: "editorial",
    label: "Editorial",
    subcategories: [
      { value: "devotional", label: "Devotional" },
      { value: "feature-highlight", label: "Feature Highlight" },
    ],
  },
  {
    value: "community",
    label: "Community",
    subcategories: [
      { value: "community", label: "Community" },
      { value: "sharing", label: "Sharing" },
    ],
  },
];

export const CONTENT_CARD_CATEGORY_VALUES: string[] = CONTENT_CARD_CATEGORIES.map((c) => c.value);

export const CONTENT_CARD_SUBCATEGORIES: Record<string, string[]> = Object.fromEntries(
  CONTENT_CARD_CATEGORIES.map((c) => [c.value, c.subcategories.map((s) => s.value)]),
);
