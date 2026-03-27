import { FrequencyCap, MessageVariant, SchedulingRule } from "@/types/agent";

/**
 * Returns the effective frequency cap for a selected variant.
 * Variant-level override takes precedence over agent-level scheduling rule.
 */
export function resolveFrequencyCap(
  agentRule: SchedulingRule | null | undefined,
  selectedVariant: MessageVariant | null | undefined
): FrequencyCap | null {
  if (selectedVariant?.frequencyCapOverride) {
    try {
      return JSON.parse(selectedVariant.frequencyCapOverride) as FrequencyCap;
    } catch {
      // fall through to agent rule
    }
  }
  return agentRule?.frequencyCap ?? null;
}
