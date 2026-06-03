"use client";

import dynamic from "next/dynamic";
import type { Persona } from "@/types/persona";

const AgentWizard = dynamic(
  () => import("@/components/agents/agent-wizard").then((m) => m.AgentWizard),
  { ssr: false },
);

export function AgentWizardClient({
  personas,
  pushPreferredCount,
  totalUsers,
}: {
  personas: Persona[];
  pushPreferredCount: number;
  totalUsers: number;
}) {
  return (
    <AgentWizard
      personas={personas}
      pushPreferredCount={pushPreferredCount}
      totalUsers={totalUsers}
    />
  );
}
