import type { Preset } from "./types";

const ALL = [{ id: "all", label: "Everyone", share: 1 }];

// Rates validated against the real engine on 2026-10-14 (seeds 1–3): Thompson
// moves ≥92% of day-30 traffic to the best winback variant; LinUCB converts
// ~8% vs Thompson ~5% on upsell.
export const PRESETS: Preset[] = [
  {
    id: "winback",
    title: "Win back lapsed users",
    description: "Users inactive 14+ days. Four push messages compete to bring them back.",
    segments: ALL,
    variants: [
      { id: "A", label: "Reminder", copy: "We saved your spot. Pick up where you left off.", rates: [0.021] },
      { id: "B", label: "Social proof", copy: "12,000 people finished this week's challenge.", rates: [0.034] },
      { id: "C", label: "Discount", copy: "Come back today: 20% off your next month.", rates: [0.028] },
      { id: "D", label: "Personal progress", copy: "You're 3 days from your best streak ever.", rates: [0.046] },
    ],
    days: 30,
    usersPerDay: 500,
    holdoutShare: 0.1,
  },
  {
    id: "onboarding",
    title: "Onboarding day 1–7",
    description: "New sign-ups. Which first-week nudge gets them to the key action?",
    segments: ALL,
    variants: [
      { id: "A", label: "Feature tour", copy: "Three things you can do in your first minute.", rates: [0.12] },
      { id: "B", label: "Quick win", copy: "Finish setup in 30 seconds and unlock your plan.", rates: [0.18] },
      { id: "C", label: "Founder note", copy: "A personal welcome, and one tip that matters.", rates: [0.14] },
      { id: "D", label: "Checklist", copy: "Your 4-step start checklist is ready.", rates: [0.15] },
    ],
    days: 30,
    usersPerDay: 500,
    holdoutShare: 0.1,
  },
  {
    id: "upsell",
    title: "Upsell to paid",
    description: "Free users in three segments. Each segment responds to a different pitch, so a single A/B winner leaves money on the table.",
    segments: [
      { id: "power", label: "Power users", share: 0.4 },
      { id: "casual", label: "Casual users", share: 0.35 },
      { id: "teams", label: "Team admins", share: 0.25 },
    ],
    variants: [
      { id: "A", label: "Unlimited usage", copy: "You've hit the free limit 3 times. Go unlimited.", rates: [0.09, 0.02, 0.03] },
      { id: "B", label: "Annual discount", copy: "Two months free when you pay yearly.", rates: [0.03, 0.08, 0.02] },
      { id: "C", label: "Team seats", copy: "Add your team and manage billing in one place.", rates: [0.02, 0.03, 0.1] },
      { id: "D", label: "Generic upgrade", copy: "Upgrade to Pro.", rates: [0.05, 0.05, 0.05] },
    ],
    days: 30,
    usersPerDay: 500,
    holdoutShare: 0.1,
  },
];

export function getPreset(id: string): Preset {
  const p = PRESETS.find((x) => x.id === id);
  if (!p) throw new Error(`Unknown preset: ${id}`);
  return p;
}
