/**
 * Seed the Persona table from the 12 mock personas.
 * Run with: npx tsx prisma/seed-personas.ts
 */

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter } as ConstructorParameters<typeof PrismaClient>[0]);

const mockPersonas = [
  {
    name: "Morning Devotee",
    label: "Sarah",
    icon: "Sun",
    color: "amber",
    description: "Starts every morning with scripture and a devotional plan. Deeply consistent and emotionally connected to the app.",
    tags: ["high-value", "plans", "retention-safe", "morning"],
    traits: {
      lifeContext: "Suburban mom, 2 kids, career professional. Uses the app before the household wakes up as personal spiritual time.",
      demographics: { ageRange: "35-44", gender: "F" },
      engagement: { level: "daily", label: "Daily (5-7d/wk)" },
      contentModes: ["text", "plans"],
      features: ["Reading Plans", "Daily Verse", "Bookmarks", "Highlights"],
      channels: ["push", "email"],
      metrics: { userCount: 425000, percentOfTotal: 17, avgSessionsPerWeek: 6.2, conversionRate: 8.4, churnRisk: 12, ltv: 9, avgSessionMinutes: 14, streakDays: 142 },
    },
  },
  {
    name: "Audio Commuter",
    label: "Marcus",
    icon: "Headphones",
    color: "blue",
    description: "Listens to audio Bible during commute or workout. Rarely opens app manually but responds well to audio content notifications.",
    tags: ["audio-first", "commuter", "push-responsive"],
    traits: {
      lifeContext: "Young professional, daily commuter, fitness enthusiast. 45-60 min daily commute is prime listening time.",
      demographics: { ageRange: "28-34", gender: "M" },
      engagement: { level: "regular", label: "Regular (4-5d/wk)" },
      contentModes: ["audio"],
      features: ["Audio Bible", "Listening Plans", "Autoplay", "Sleep Timer"],
      channels: ["push", "email"],
      metrics: { userCount: 312000, percentOfTotal: 12.5, avgSessionsPerWeek: 4.5, conversionRate: 6.2, churnRisk: 22, ltv: 7, avgSessionMinutes: 32, streakDays: 54 },
    },
  },
  {
    name: "Deep Diver",
    label: "Thomas",
    icon: "BookOpen",
    color: "indigo",
    description: "Studies the Bible seriously. Uses cross-references, commentaries, and original language tools. Highest session duration.",
    tags: ["power-user", "study", "high-session-time", "multi-translation"],
    traits: {
      lifeContext: "Seminary student or serious lay theologian. Treats YouVersion as a research tool alongside physical Bibles.",
      demographics: { ageRange: "22-28", gender: "M" },
      engagement: { level: "daily", label: "Daily (6-7d/wk)" },
      contentModes: ["text", "cross-refs"],
      features: ["Cross-References", "Commentaries", "Multi-Translation", "Notes", "Highlights"],
      channels: ["email", "push"],
      metrics: { userCount: 189000, percentOfTotal: 7.6, avgSessionsPerWeek: 6.8, conversionRate: 9.1, churnRisk: 8, ltv: 10, avgSessionMinutes: 28, streakDays: 230 },
    },
  },
  {
    name: "Social Sharer",
    label: "Priya",
    icon: "Share2",
    color: "pink",
    description: "Shares verses and devotionals frequently on social media. Strong referral driver and community builder.",
    tags: ["viral", "social", "referral-driver", "visual"],
    traits: {
      lifeContext: "College student or young professional. Faith is part of identity; sharing scripture is natural expression.",
      demographics: { ageRange: "18-24", gender: "F" },
      engagement: { level: "regular", label: "Regular (4-5d/wk)" },
      contentModes: ["text", "short-video"],
      features: ["Verse Image", "Share", "Stories", "Community Plans"],
      channels: ["push", "in-app"],
      metrics: { userCount: 278000, percentOfTotal: 11.1, avgSessionsPerWeek: 4.3, conversionRate: 7.8, churnRisk: 25, ltv: 6, avgSessionMinutes: 9, streakDays: 38 },
    },
  },
  {
    name: "VOTD Only",
    label: "Robert",
    icon: "Quote",
    color: "slate",
    description: "Opens app primarily for the Verse of the Day. Light user but consistent. Responds only to VOTD-style content.",
    tags: ["light-user", "votd", "older-demo", "simple"],
    traits: {
      lifeContext: "Retired or empty-nester. App is a daily ritual but not deep engagement. Values simplicity.",
      demographics: { ageRange: "55-65", gender: "M" },
      engagement: { level: "sporadic", label: "Sporadic (2-3d/wk)" },
      contentModes: ["text"],
      features: ["Verse of the Day", "Daily Notifications"],
      channels: ["push"],
      metrics: { userCount: 356000, percentOfTotal: 14.2, avgSessionsPerWeek: 2.4, conversionRate: 3.1, churnRisk: 38, ltv: 3, avgSessionMinutes: 3, streakDays: 18 },
    },
  },
  {
    name: "Lapsed Believer",
    label: "Jessica",
    icon: "CloudOff",
    color: "gray",
    description: "Was an active user but hasn't engaged in 30+ days. High churn risk, needs winback messaging.",
    tags: ["winback", "lapsed", "churn-risk", "re-engagement"],
    traits: {
      lifeContext: "Life got busy—new job, relationship, kids. Faith still matters but the habit broke.",
      demographics: { ageRange: "30-39", gender: "F" },
      engagement: { level: "dormant", label: "Dormant (0-1d/mo)" },
      contentModes: ["text", "plans"],
      features: [],
      channels: ["push", "email"],
      metrics: { userCount: 198000, percentOfTotal: 7.9, avgSessionsPerWeek: 0.2, conversionRate: 2.1, churnRisk: 82, ltv: 2, avgSessionMinutes: 2, streakDays: 0 },
    },
  },
  {
    name: "Video Watcher",
    label: "Diego",
    icon: "Play",
    color: "red",
    description: "Primarily engages with video content. Short attention span for text but watches full devotional videos.",
    tags: ["video-first", "younger-demo", "visual", "short-form"],
    traits: {
      lifeContext: "Teenager or young adult, grew up with YouTube. Scripture comes alive through storytelling and visuals.",
      demographics: { ageRange: "16-22", gender: "M" },
      engagement: { level: "regular", label: "Regular (3-4d/wk)" },
      contentModes: ["video"],
      features: ["Video Devotionals", "Bible Stories", "Short Clips"],
      channels: ["push", "in-app"],
      metrics: { userCount: 145000, percentOfTotal: 5.8, avgSessionsPerWeek: 3.6, conversionRate: 4.9, churnRisk: 35, ltv: 4, avgSessionMinutes: 12, streakDays: 22 },
    },
  },
  {
    name: "Prayer Warrior",
    label: "Grace",
    icon: "Heart",
    color: "purple",
    description: "Uses the app primarily for prayer journaling and scripture meditation. Deeply spiritual, low churn, high LTV.",
    tags: ["prayer", "high-value", "church-connected", "premium-candidate"],
    traits: {
      lifeContext: "Church leader or ministry volunteer. Prayer is the center of life; app is an extension of devotional practice.",
      demographics: { ageRange: "45-55", gender: "F" },
      engagement: { level: "daily", label: "Daily (6-7d/wk)" },
      contentModes: ["text"],
      features: ["Prayer", "Highlights", "Journal", "Plans", "Reading History"],
      channels: ["push", "email"],
      metrics: { userCount: 167000, percentOfTotal: 6.7, avgSessionsPerWeek: 6.5, conversionRate: 10.2, churnRisk: 6, ltv: 10, avgSessionMinutes: 18, streakDays: 312 },
    },
  },
  {
    name: "New Believer",
    label: "Aiden",
    icon: "Sprout",
    color: "green",
    description: "Recently came to faith or rededicated. Curious, exploring, needs guidance. High growth potential.",
    tags: ["onboarding", "growth", "beginner", "plan-candidate"],
    traits: {
      lifeContext: "Came to faith through a friend, church event, or life crisis. Eager to learn but unsure where to start.",
      demographics: { ageRange: "25-32", gender: "M" },
      engagement: { level: "moderate", label: "Moderate (3-4d/wk)" },
      contentModes: ["text", "intro-video"],
      features: ["Beginner Plans", "What the Bible Says", "Video Intro", "Community"],
      channels: ["push", "email", "in-app"],
      metrics: { userCount: 134000, percentOfTotal: 5.4, avgSessionsPerWeek: 3.2, conversionRate: 7.3, churnRisk: 42, ltv: 6, avgSessionMinutes: 11, streakDays: 15 },
    },
  },
  {
    name: "Pastor",
    label: "Paul",
    icon: "Landmark",
    color: "teal",
    description: "Professional minister using the app for sermon prep, multi-translation comparison, and congregation resources.",
    tags: ["power-user", "professional", "multi-translation", "premium"],
    traits: {
      lifeContext: "Lead pastor or associate minister. Uses YouVersion daily for professional ministry work and personal devotion.",
      demographics: { ageRange: "40-55", gender: "M" },
      engagement: { level: "daily", label: "Daily (7d/wk)" },
      contentModes: ["text", "multi-translation"],
      features: ["Multi-Translation", "Notes", "Commentaries", "Verse Lists", "Cross-References"],
      channels: ["email", "push"],
      metrics: { userCount: 89000, percentOfTotal: 3.6, avgSessionsPerWeek: 7.0, conversionRate: 11.4, churnRisk: 4, ltv: 10, avgSessionMinutes: 35, streakDays: 480 },
    },
  },
  {
    name: "Weekend Warrior",
    label: "Kim",
    icon: "CalendarDays",
    color: "orange",
    description: "Engages primarily on weekends, often tied to church attendance and Sunday routines.",
    tags: ["weekend", "church-goer", "moderate-value"],
    traits: {
      lifeContext: "Working parent. Weekdays are too busy; faith practice is a weekend ritual centered around church.",
      demographics: { ageRange: "35-45", gender: "F" },
      engagement: { level: "weekly", label: "Weekly (1-2d/wk)" },
      contentModes: ["text", "audio"],
      features: ["Weekend Plans", "Church Resources", "Audio Bible"],
      channels: ["push", "email"],
      metrics: { userCount: 213000, percentOfTotal: 8.5, avgSessionsPerWeek: 1.5, conversionRate: 4.6, churnRisk: 45, ltv: 4, avgSessionMinutes: 8, streakDays: 9 },
    },
  },
  {
    name: "Teen Explorer",
    label: "Jayden",
    icon: "Compass",
    color: "cyan",
    description: "Teenager exploring faith, drawn to visual and social features. Inconsistent but high lifetime potential.",
    tags: ["teen", "sporadic", "video", "long-term-value"],
    traits: {
      lifeContext: "High schooler, faith influenced by family or friends. Discovering personal relationship with scripture for the first time.",
      demographics: { ageRange: "14-17", gender: "M" },
      engagement: { level: "sporadic", label: "Sporadic (2-3d/wk)" },
      contentModes: ["video", "audio"],
      features: ["Bible Stories", "Video", "Short Audio", "Friends Plans"],
      channels: ["push", "in-app"],
      metrics: { userCount: 93000, percentOfTotal: 3.7, avgSessionsPerWeek: 2.1, conversionRate: 3.8, churnRisk: 55, ltv: 5, avgSessionMinutes: 7, streakDays: 8 },
    },
  },
];

async function main() {
  console.log("Seeding personas…");

  for (const p of mockPersonas) {
    const existing = await prisma.persona.findFirst({ where: { name: p.name, source: "manual" } });

    if (existing) {
      await prisma.persona.update({
        where: { id: existing.id },
        data: {
          label: p.label,
          icon: p.icon,
          color: p.color,
          description: p.description,
          tags: p.tags,
          traits: p.traits,
          isActive: true,
        },
      });
      console.log(`  Updated: ${p.name}`);
    } else {
      await prisma.persona.create({
        data: {
          name: p.name,
          label: p.label,
          icon: p.icon,
          color: p.color,
          description: p.description,
          source: "manual",
          tags: p.tags,
          traits: p.traits,
          isActive: true,
        },
      });
      console.log(`  Created: ${p.name}`);
    }
  }

  const count = await prisma.persona.count({ where: { source: "manual" } });
  console.log(`Done. ${count} manual personas in DB.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
