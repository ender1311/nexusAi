import { Header } from "@/components/layout/header";
import { AgentWizard } from "@/components/agents/agent-wizard";

export default function NewAgentPage() {
  return (
    <>
      <Header title="Create Agent" description="Configure a new Nexus agent" />
      <div className="p-6">
        <AgentWizard />
      </div>
    </>
  );
}
