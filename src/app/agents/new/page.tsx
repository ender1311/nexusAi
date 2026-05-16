export const revalidate = 300;

import { Header } from "@/components/layout/header";
import { AgentWizardClient } from "./agent-wizard-client";
import { prisma } from "@/lib/db";
import type { Persona } from "@/types/persona";

export default async function NewAgentPage() {
  const personas = (await prisma.persona.findMany({ orderBy: { name: "asc" } })) as unknown as Persona[];
  return (
    <>
      <Header title="Create Agent" description="Configure a new Nexus agent" />
      <div className="p-4 sm:p-6">
        <AgentWizardClient personas={personas} />
      </div>
    </>
  );
}
