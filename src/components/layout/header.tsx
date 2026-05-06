import type { ReactNode } from "react";

type HeaderProps = {
  title: string;
  description?: string;
  children?: ReactNode;
};

export function Header({ title, description, children }: HeaderProps) {
  return (
    <header className="min-h-14 border-b flex items-center justify-between px-4 sm:px-6 bg-background gap-3 py-3 sm:py-0 sm:h-16 flex-wrap sm:flex-nowrap">
      <div>
        <h1 className="text-lg font-semibold">{title}</h1>
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
