// Canonical slideup (in-app message) category catalogue — single source of truth
// for the slideup library taxonomy. Mirrors email-categories.ts pattern.

export type SlideupSubcategory = { value: string; label: string };
export type SlideupCategory = { value: string; label: string; subcategories: SlideupSubcategory[] };

export const SLIDEUP_CATEGORIES: SlideupCategory[] = [
  {
    value: "giving",
    label: "Giving",
    subcategories: [
      { value: "appeal", label: "Appeal" },
      { value: "sowers", label: "Sowers" },
      { value: "giving-tuesday", label: "Giving Tuesday" },
      { value: "year-end", label: "Year-End" },
      { value: "thank-you", label: "Thank You" },
    ],
  },
  {
    value: "bible-plans",
    label: "Bible Plans",
    subcategories: [
      { value: "featured-plans", label: "Featured Plans" },
      { value: "challenge", label: "Challenge" },
      { value: "seasonal-plans", label: "Seasonal Plans" },
      { value: "discovery", label: "Discovery" },
    ],
  },
  {
    value: "feature-education",
    label: "Feature Education",
    subcategories: [
      { value: "new-feature", label: "New Feature" },
      { value: "engagement", label: "Engagement" },
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
      { value: "good-friday", label: "Good Friday" },
    ],
  },
  {
    value: "community",
    label: "Community",
    subcategories: [
      { value: "sharing", label: "Sharing" },
      { value: "survey", label: "Survey" },
      { value: "social", label: "Social" },
    ],
  },
  {
    value: "editorial",
    label: "Editorial",
    subcategories: [
      { value: "devotional", label: "Devotional" },
      { value: "general", label: "General" },
    ],
  },
];

export const SLIDEUP_CATEGORY_VALUES: string[] = SLIDEUP_CATEGORIES.map((c) => c.value);

export const SLIDEUP_SUBCATEGORIES: Record<string, string[]> = Object.fromEntries(
  SLIDEUP_CATEGORIES.map((c) => [c.value, c.subcategories.map((s) => s.value)]),
);
