import { Globe } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { countCoverageLanguages, formatLanguageCoverage } from "@/lib/push-coverage";

export function LanguageCoverageBadge({ languages }: { languages: string[] }) {
  const localized = countCoverageLanguages(languages) > 0;
  return (
    <Badge variant={localized ? "secondary" : "outline"} className="shrink-0 gap-1 text-xs">
      <Globe className="h-3 w-3" />
      {formatLanguageCoverage(languages)}
    </Badge>
  );
}
