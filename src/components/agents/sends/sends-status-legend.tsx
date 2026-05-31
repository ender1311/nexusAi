import { cn } from "@/lib/utils";
import type { AgentSendDeliveryStatus } from "@/lib/agent-send-delivery-status";

export function SendsStatusLegend() {
  const items: { status: AgentSendDeliveryStatus; label: string; detail: string }[] = [
    {
      status: "delivered",
      label: "Delivered",
      detail: "Braze returned success for this send or schedule.",
    },
    {
      status: "failed",
      label: "Failed",
      detail: "Braze returned an error (see expanded row / server logs).",
    },
    {
      status: "pending",
      label: "Pending",
      detail: "Delivery is scheduled for a future time.",
    },
  ];
  return (
    <div className="rounded-lg border bg-muted/20 px-3 py-2.5">
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">
        Row status
      </p>
      <ul className="flex flex-col sm:flex-row sm:flex-wrap gap-2 sm:gap-x-6 sm:gap-y-2">
        {items.map(({ status, label, detail }) => (
          <li key={status} className="flex items-start gap-2 min-w-0 sm:max-w-[220px]">
            <span
              className={cn(
                "mt-0.5 h-2.5 w-2.5 rounded-full shrink-0",
                status === "delivered" && "bg-emerald-500",
                status === "failed" && "bg-red-500",
                status === "pending" && "bg-amber-400",
              )}
              aria-hidden
            />
            <span className="text-xs leading-snug">
              <span className="font-medium text-foreground">{label}</span>
              <span className="text-muted-foreground"> — {detail}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
