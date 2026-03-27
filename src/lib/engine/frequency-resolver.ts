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
    return selectedVariant.frequencyCapOverride as unknown as FrequencyCap;
  }
  return agentRule?.frequencyCap ?? null;
}
