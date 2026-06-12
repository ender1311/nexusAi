// Canonical email category catalogue — single source of truth for email library
// taxonomy. Mirrors push-categories.ts pattern.

export type EmailSubcategory = { value: string; label: string };
export type EmailCategory = { value: string; label: string; subcategories: EmailSubcategory[] };

export const EMAIL_CATEGORIES: EmailCategory[] = [
  {
    value: "giving",
    label: "Giving",
    subcategories: [
      { value: "appeal", label: "Appeal" },
      { value: "sowers", label: "Sowers" },
      { value: "giving-tuesday", label: "Giving Tuesday" },
      { value: "year-end", label: "Year-End" },
      { value: "annual-statement", label: "Annual Statement" },
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

export const EMAIL_CATEGORY_VALUES: string[] = EMAIL_CATEGORIES.map((c) => c.value);

export const EMAIL_SUBCATEGORIES: Record<string, string[]> = Object.fromEntries(
  EMAIL_CATEGORIES.map((c) => [c.value, c.subcategories.map((s) => s.value)]),
);

export const EMAIL_LIBRARY_AGENT_NAME = "__email_library__";
