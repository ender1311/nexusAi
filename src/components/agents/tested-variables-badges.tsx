import { Badge } from "@/components/ui/badge";
import { TestedVariable } from "@/types/agent";
import { TESTED_VARIABLE_LABELS } from "@/lib/constants/youversion";

interface TestedVariablesBadgesProps {
  variables: TestedVariable[];
}

export function TestedVariablesBadges({ variables }: TestedVariablesBadgesProps) {
  if (variables.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {variables.map((v) => (
        <Badge key={v} variant="secondary" className="text-xs">
          Testing: {TESTED_VARIABLE_LABELS[v]}
        </Badge>
      ))}
    </div>
  );
}
