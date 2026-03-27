"use client";

import { Bell, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface HeaderProps {
  title: string;
  description?: string;
}

export function Header({ title, description }: HeaderProps) {
  return (
    <header className="h-16 border-b flex items-center justify-between px-6 bg-background">
      <div>
        <h1 className="text-lg font-semibold">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
          <span className="text-xs text-muted-foreground">Engine Active</span>
        </div>
        <Badge variant="outline" className="text-xs">
          <RefreshCw className="h-3 w-3 mr-1" />
          Live
        </Badge>
        <button className="p-2 rounded-md hover:bg-muted text-muted-foreground">
          <Bell className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
