import type { ReactNode } from "react";

type HeaderProps = {
  title: string;
  description?: string;
  children?: ReactNode;
};

export function Header({ title, description, children }: HeaderProps) {
  return (
    <header className="h-16 border-b flex items-center justify-between px-6 bg-background">
      <div>
        <h1 className="text-lg font-semibold">{title}</h1>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      <div className="flex items-center gap-3">
        {children}
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-green-500 motion-safe:animate-pulse" />
          <span className="text-xs text-muted-foreground">Engine Active</span>
        </div>
      </div>
    </header>
  );
}
