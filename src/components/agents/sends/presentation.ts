import type { AgentSendDeliveryStatus } from "@/lib/agent-send-delivery-status";

const PERSONA_COLOR_CLASSES: Record<string, string> = {
  blue:   "bg-blue-500",
  green:  "bg-green-500",
  purple: "bg-purple-500",
  amber:  "bg-amber-500",
  rose:   "bg-rose-500",
  teal:   "bg-teal-500",
  indigo: "bg-indigo-500",
  orange: "bg-orange-500",
  pink:   "bg-pink-500",
  cyan:   "bg-cyan-500",
};

export function personaDot(color: string | null): string {
  return PERSONA_COLOR_CLASSES[color ?? ""] ?? "bg-muted-foreground/40";
}

export function rowStatusClasses(status: AgentSendDeliveryStatus): string {
  if (status === "failed") {
    return "bg-red-50 hover:bg-red-100 dark:bg-red-950/20 dark:hover:bg-red-950/30";
  }
  if (status === "pending") {
    return "bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/20 dark:hover:bg-amber-950/35";
  }
  return "bg-emerald-50/50 hover:bg-emerald-100/60 dark:bg-emerald-950/15 dark:hover:bg-emerald-950/25";
}

export function deliveryStatusLabel(status: AgentSendDeliveryStatus): string {
  if (status === "failed") return "Failed (Braze error)";
  if (status === "pending") return "Pending (scheduled)";
  return "Delivered (Braze OK)";
}
