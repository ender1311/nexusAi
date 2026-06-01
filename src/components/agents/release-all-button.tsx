"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function ReleaseAllButton({ agentId }: { agentId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [released, setReleased] = useState<number | null>(null);

  async function handleClick() {
    setPending(true);
    setReleased(null);
    try {
      const res = await fetch(`/api/agents/${agentId}/release`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (res.ok) {
        const body = (await res.json()) as { data: { released: number } };
        setReleased(body.data.released);
        router.refresh();
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={handleClick} disabled={pending}>
      {pending ? "Releasing…" : released !== null ? `Released ${released}` : "Release users"}
    </Button>
  );
}
