import { cn } from "@/lib/utils";

const NATIVE_SOURCE = "nexus-library";

const SOURCE_LABELS: Record<string, string> = {
  contentful: "Contentful",
  sanity: "Sanity",
  "generic-json": "JSON",
  "braze-catalog": "Braze Catalog",
};

/** Variants synced from an external source are read-only for copy; edits happen at the source. */
export function isSyncedSource(source: string | null | undefined): boolean {
  return !!source && source !== NATIVE_SOURCE;
}

export function contentfulEditUrl(spaceId: string, entryId: string): string {
  return `https://app.contentful.com/spaces/${spaceId}/entries/${entryId}`;
}

type Props = {
  source: string | null | undefined;
  externalRef: string | null | undefined;
  editUrl?: string;
  className?: string;
};

export function SourceBadge({ source, externalRef, editUrl, className }: Props) {
  if (!source || !isSyncedSource(source)) return null;
  const label = SOURCE_LABELS[source] ?? source;
  const classes = cn(
    "ml-1.5 inline-flex shrink-0 items-center rounded-full border border-border bg-muted px-1.5 py-0 align-middle text-[10px] font-medium leading-4 text-muted-foreground",
    className,
  );
  const title = "Synced — edit at the source";
  if (editUrl) {
    return (
      <a
        href={editUrl}
        target="_blank"
        rel="noopener noreferrer"
        title={title}
        data-external-ref={externalRef ?? undefined}
        className={cn(classes, "hover:text-foreground")}
        onClick={(e) => e.stopPropagation()}
      >
        {label}
      </a>
    );
  }
  return <span title={title} data-external-ref={externalRef ?? undefined} className={classes}>{label}</span>;
}
