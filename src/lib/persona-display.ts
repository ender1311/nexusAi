import {
  Sun, Headphones, BookOpen, Share2, Quote, CloudOff,
  Play, Heart, Sprout, Landmark, CalendarDays, Compass,
  LucideIcon,
} from "lucide-react";
import { PersonaColorConfig } from "@/types/persona";

/**
 * Persona display config — Tailwind class sets per color name and the icon
 * registry keyed by icon name. Used by production persona/agent UI; lives here
 * (not in lib/mock) because it drives real rendering, not fixture data.
 */
export const PERSONA_COLORS: Record<string, PersonaColorConfig> = {
  amber: {
    bg: "bg-amber-50",
    text: "text-amber-700",
    border: "border-amber-200",
    dot: "bg-amber-400",
    iconBg: "bg-amber-100",
    ring: "ring-amber-400",
  },
  blue: {
    bg: "bg-blue-50",
    text: "text-blue-700",
    border: "border-blue-200",
    dot: "bg-blue-400",
    iconBg: "bg-blue-100",
    ring: "ring-blue-400",
  },
  indigo: {
    bg: "bg-indigo-50",
    text: "text-indigo-700",
    border: "border-indigo-200",
    dot: "bg-indigo-400",
    iconBg: "bg-indigo-100",
    ring: "ring-indigo-400",
  },
  pink: {
    bg: "bg-pink-50",
    text: "text-pink-700",
    border: "border-pink-200",
    dot: "bg-pink-400",
    iconBg: "bg-pink-100",
    ring: "ring-pink-400",
  },
  slate: {
    bg: "bg-slate-50",
    text: "text-slate-700",
    border: "border-slate-200",
    dot: "bg-slate-400",
    iconBg: "bg-slate-100",
    ring: "ring-slate-400",
  },
  gray: {
    bg: "bg-gray-50",
    text: "text-gray-600",
    border: "border-gray-200",
    dot: "bg-gray-400",
    iconBg: "bg-gray-100",
    ring: "ring-gray-400",
  },
  red: {
    bg: "bg-red-50",
    text: "text-red-700",
    border: "border-red-200",
    dot: "bg-red-400",
    iconBg: "bg-red-100",
    ring: "ring-red-400",
  },
  purple: {
    bg: "bg-purple-50",
    text: "text-purple-700",
    border: "border-purple-200",
    dot: "bg-purple-400",
    iconBg: "bg-purple-100",
    ring: "ring-purple-400",
  },
  green: {
    bg: "bg-green-50",
    text: "text-green-700",
    border: "border-green-200",
    dot: "bg-green-400",
    iconBg: "bg-green-100",
    ring: "ring-green-400",
  },
  teal: {
    bg: "bg-teal-50",
    text: "text-teal-700",
    border: "border-teal-200",
    dot: "bg-teal-400",
    iconBg: "bg-teal-100",
    ring: "ring-teal-400",
  },
  orange: {
    bg: "bg-orange-50",
    text: "text-orange-700",
    border: "border-orange-200",
    dot: "bg-orange-400",
    iconBg: "bg-orange-100",
    ring: "ring-orange-400",
  },
  cyan: {
    bg: "bg-cyan-50",
    text: "text-cyan-700",
    border: "border-cyan-200",
    dot: "bg-cyan-400",
    iconBg: "bg-cyan-100",
    ring: "ring-cyan-400",
  },
};

export const PERSONA_ICON_MAP: Record<string, LucideIcon> = {
  Sun,
  Headphones,
  BookOpen,
  Share2,
  Quote,
  CloudOff,
  Play,
  Heart,
  Sprout,
  Landmark,
  CalendarDays,
  Compass,
};
