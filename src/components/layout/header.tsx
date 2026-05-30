import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

type HeaderProps = {
  title: string;
  titleNode?: ReactNode;
  description?: string;
  backHref?: string;
  backLabel?: string;
  children?: ReactNode;
};

export function Header({ title, titleNode, description, backHref, backLabel, children }: HeaderProps) {
  return (
    <header className="min-h-14 border-b flex items-center justify-between px-4 sm:px-6 bg-background gap-3 py-3 sm:py-0 sm:h-16 flex-wrap sm:flex-nowrap">
      <div>
        {backHref && (
          <Link
            href={backHref}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-0.5"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {backLabel ?? "Back"}
          </Link>
        )}
        {titleNode ?? <h1 className="text-lg font-semibold">{title}</h1>}
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      <div className="flex items-center gap-3">
        {children}
      </div>
    </header>
  );
}
