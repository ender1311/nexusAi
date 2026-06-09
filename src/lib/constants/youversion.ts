import { GoalTier, PushDeeplink, TestedVariable } from "@/types/agent";
import { INTERACTION_FLAGS, INTERACTION_FLAG_LABELS } from "@/lib/constants/interaction-flags";

export interface YouVersionGoalPreset {
  eventName: string;
  label: string;
  tier: GoalTier;
  weight: number;
  description: string;
}

export const YOUVERSION_GOALS: YouVersionGoalPreset[] = [
  // Positive goals
  { eventName: "session_start", label: "Have a session", tier: "best", weight: 3, description: "User starts a session in the app" },
  { eventName: "gift_given", label: "Give a gift", tier: "best", weight: 10, description: "User completes a gift/donation" },
  { eventName: "sower_subscribed", label: "Become a sower", tier: "best", weight: 10, description: "User subscribes to sower program" },
  { eventName: "plan_started", label: "Start a bible plan", tier: "very_good", weight: 7, description: "User starts a Bible reading plan" },
  { eventName: "guided_scripture_start", label: "Start guided scripture", tier: "very_good", weight: 7, description: "User starts guided scripture session" },
  { eventName: "video_start", label: "Start a video", tier: "good", weight: 5, description: "User plays a video" },
  { eventName: "audio_bible_start", label: "Start audio bible", tier: "good", weight: 5, description: "User starts listening to audio Bible" },
  { eventName: "reader_start", label: "Start reading in reader", tier: "good", weight: 5, description: "User opens the Bible reader" },
  // Negative outcomes
  { eventName: "push_unsubscribe", label: "Unsubscribed from push", tier: "worst", weight: -10, description: "User disables push notifications" },
  { eventName: "app_uninstall", label: "Uninstalled app", tier: "worst", weight: -10, description: "User uninstalls the app" },
];

export const YOUVERSION_DEEPLINKS: PushDeeplink[] = [
  // General
  { label: "Home", value: "youversion://home", category: "General" },
  { label: "Verse of the Day", value: "youversion://votd", category: "General" },
  { label: "Discover", value: "youversion://discover", category: "General" },
  { label: "Settings", value: "youversion://settings", category: "General" },
  // Bible Plans
  { label: "Browse Plans", value: "youversion://plans", category: "Bible Plans" },
  { label: "My Plans", value: "youversion://plans/my", category: "Bible Plans" },
  { label: "Plan of the Year", value: "youversion://plans/featured", category: "Bible Plans" },
  // Reading
  { label: "Bible Reader", value: "youversion://bible", category: "Reading" },
  { label: "Guided Scripture", value: "youversion://guided-scripture", category: "Reading" },
  { label: "Reading History", value: "youversion://bible/history", category: "Reading" },
  // Media
  { label: "Videos", value: "youversion://videos", category: "Media" },
  { label: "Audio Bible", value: "youversion://audio-bible", category: "Media" },
  { label: "Podcasts", value: "youversion://podcasts", category: "Media" },
  // Giving
  { label: "Give a Gift", value: "youversion://giving", category: "Giving" },
  { label: "Sower Program", value: "youversion://giving/sower", category: "Giving" },
  // Web links (bible.com) — open in browser/app via universal links
  { label: "Find Plans (web)", value: "https://www.bible.com/reading-plans", category: "Web Links" },
  { label: "My Plans (web)", value: "https://www.bible.com/my-plans", category: "Web Links" },
  { label: "Saved Plans (web)", value: "https://www.bible.com/saved_plans", category: "Web Links" },
  { label: "Verse of the Day (web)", value: "https://www.bible.com/verse-of-the-day", category: "Web Links" },
];

export const TESTED_VARIABLE_LABELS: Record<TestedVariable, string> = {
  title: "Title",
  body: "Body",
  deeplink: "Deeplink",
  iconImageUrl: "Icon Image",
  sendHour: "Send Hour",
  sendDayOfWeek: "Send Day",
  frequencyCap: "Frequency Cap",
};

export const INTERACTION_GOALS: YouVersionGoalPreset[] = INTERACTION_FLAGS.map((flag) => ({
  eventName: flag,
  label: INTERACTION_FLAG_LABELS[flag],
  tier: "very_good" as GoalTier,
  weight: 5,
  description: INTERACTION_FLAG_LABELS[flag],
}));

export const POSITIVE_GOALS = YOUVERSION_GOALS.filter((g) => g.weight > 0);
export const NEGATIVE_OUTCOMES = YOUVERSION_GOALS.filter((g) => g.weight < 0);

export type GoalColorGroup = "green" | "red" | "blue";

// Giving outcomes (gift + sower) are the headline conversions, so they read green;
// every other positive goal is blue and any negative outcome is red.
const GREEN_GOAL_EVENTS = new Set(["gift_given", "sower_subscribed"]);

export function goalColorGroup(goal: { eventName: string; weight: number }): GoalColorGroup {
  if (goal.weight < 0) return "red";
  if (GREEN_GOAL_EVENTS.has(goal.eventName)) return "green";
  return "blue";
}
