import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { HightouchSource, HightouchDestination } from "@/lib/hightouch/types";

function typeClasses(type: string): string {
  switch (type.toLowerCase()) {
    case "bigquery":
      return "bg-green-500/15 text-green-700 border-transparent";
    case "snowflake":
      return "bg-blue-500/15 text-blue-700 border-transparent";
    case "braze":
      return "bg-purple-500/15 text-purple-700 border-transparent";
    case "postgres":
    case "postgresql":
      return "bg-blue-500/15 text-blue-700 border-transparent";
    default:
      return "bg-muted text-muted-foreground border-transparent";
  }
}

function formatUpdatedAt(dateStr: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(dateStr));
}

type SourcesDestinationsProps = {
  sources: HightouchSource[];
  destinations: HightouchDestination[];
};

export function SourcesDestinations({ sources, destinations }: SourcesDestinationsProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Sources</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {sources.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6 px-4">
              No sources configured.
            </p>
          ) : (
            <ul className="divide-y">
              {sources.map((source) => (
                <li key={source.id} className="flex items-center justify-between px-4 py-2.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <Badge
                      variant="outline"
                      className={cn("text-xs shrink-0", typeClasses(source.type))}
                    >
                      {source.type}
                    </Badge>
                    <span className="text-xs font-medium truncate">{source.name}</span>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0 ml-2">
                    {formatUpdatedAt(source.updatedAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Destinations</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {destinations.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6 px-4">
              No destinations configured.
            </p>
          ) : (
            <ul className="divide-y">
              {destinations.map((dest) => (
                <li key={dest.id} className="flex items-center justify-between px-4 py-2.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <Badge
                      variant="outline"
                      className={cn("text-xs shrink-0", typeClasses(dest.type))}
                    >
                      {dest.type}
                    </Badge>
                    <span className="text-xs font-medium truncate">{dest.name}</span>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0 ml-2">
                    {formatUpdatedAt(dest.updatedAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
