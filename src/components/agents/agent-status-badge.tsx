import { Badge } from "@/components/ui/badge";
import { AgentStatus } from "@/types/agent";
import { cn } from "@/lib/utils";

const statusConfig: Record<AgentStatus, { label: string; className: string }> = {
  active: { label: "Active", className: "bg-green-100 text-green-700 border-green-200" },
  draft: { label: "Draft", className: "bg-gray-100 text-gray-600 border-gray-200" },
  paused: { label: "Paused", className: "bg-yellow-100 text-yellow-700 border-yellow-200" },
};

export function AgentStatusBadge({ status }: { status: AgentStatus }) {
  const config = statusConfig[status];
  return (
    <Badge variant="outline" className={cn("text-xs font-medium", config.className)}>
      {config.label}
    </Badge>
  );
}
