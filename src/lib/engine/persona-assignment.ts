import { cosineSimilarity } from "./feature-vector";

export interface AssignmentConfig {
  minInteractions?: number;    // default 20; used to scale confidence — does not gate assignment
}

/**
 * Pick the persona whose centroid has the highest cosine similarity to the
 * user vector. Cosine similarity is in [-1, 1], so the search must start below
 * -1 — initializing at 0 would discard every user whose nearest centroid is a
 * negative (but still closest) match, dropping them to the largest-persona
 * fallback instead of their true nearest persona.
 */
export function selectNearestPersona(
  userVec: number[],
  personas: { id: string; centroid: number[] | null }[],
): { personaId: string | null; similarity: number } {
  let bestPersonaId: string | null = null;
  let bestSimilarity = -Infinity;
  for (const persona of personas) {
    if (!persona.centroid) continue;
    const similarity = cosineSimilarity(userVec, persona.centroid);
    if (similarity > bestSimilarity) {
      bestSimilarity = similarity;
      bestPersonaId = persona.id;
    }
  }
  return { personaId: bestPersonaId, similarity: bestPersonaId === null ? 0 : bestSimilarity };
}
