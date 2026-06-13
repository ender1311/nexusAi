// Canonical modal IAM category catalogue — mirrors slideup-categories.ts taxonomy.

export type ModalIamSubcategory = { value: string; label: string };
export type ModalIamCategory = { value: string; label: string; subcategories: ModalIamSubcategory[] };

export const MODAL_IAM_CATEGORIES: ModalIamCategory[] = [
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
    value: "guided-scripture",
    label: "Guided Scripture",
    subcategories: [
      { value: "guided-scripture", label: "Guided Scripture" },
      { value: "daily-refresh", label: "Daily Refresh" },
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
      { value: "feature-highlight", label: "Feature Highlight" },
      { value: "general", label: "General" },
    ],
  },
];

export const MODAL_IAM_CATEGORY_VALUES: string[] = MODAL_IAM_CATEGORIES.map((c) => c.value);

export const MODAL_IAM_SUBCATEGORIES: Record<string, string[]> = Object.fromEntries(
  MODAL_IAM_CATEGORIES.map((c) => [c.value, c.subcategories.map((s) => s.value)]),
);
