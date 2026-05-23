"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type Props = {
  modelName: string;
  sql: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ModelSqlViewer({ modelName, sql, open, onOpenChange }: Props) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(sql).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{modelName} — SQL</DialogTitle>
        </DialogHeader>
        <div className="relative">
          <Button
            size="sm"
            variant="ghost"
            className="absolute top-2 right-2 h-6 w-6 p-0 z-10"
            onClick={handleCopy}
            title="Copy SQL"
          >
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          </Button>
          <pre className="bg-muted rounded-md p-4 text-xs font-mono overflow-auto max-h-[60vh] whitespace-pre">
            {sql}
          </pre>
        </div>
      </DialogContent>
    </Dialog>
  );
}
