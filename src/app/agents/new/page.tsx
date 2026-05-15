export const revalidate = 300;

import { Header } from "@/components/layout/header";
import dynamic from "next/dynamic";
import { prisma } from "@/lib/db";
import type { Persona } from "@/types/persona";

const AgentWizard = dynamic(
  () => import("@/components/agents/agent-wizard").then((m) => m.AgentWizard),
  { ssr: false },
);

export default async function NewAgentPage() {
  const personas = (await prisma.persona.findMany({ orderBy: { name: "asc" } })) as unknown as Persona[];
  return (
    <>
      <Header title="Create Agent" description="Configure a new Nexus agent" />
      <div className="p-4 sm:p-6">
        <AgentWizard personas={personas} />
      </div>
    </>
  );
}
