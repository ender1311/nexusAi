export type ComputedUserKeys = {
  last_seen_days: number;
  total_decisions: number;
  total_conversions: number;
  persona_confidence: number;
};

type UserForComputed = {
  updatedAt: Date;
  totalDecisions: number;
  totalConversions: number;
  personaConfidence: number | null;
};

export function buildComputedKeys(user: UserForComputed): ComputedUserKeys {
  const msPerDay = 1000 * 60 * 60 * 24;
  return {
    last_seen_days: Math.floor((Date.now() - new Date(user.updatedAt).getTime()) / msPerDay),
    total_decisions: user.totalDecisions,
    total_conversions: user.totalConversions,
    persona_confidence: user.personaConfidence ?? 0,
  };
}

const OPERATORS = ["__gte", "__lte", "__gt", "__lt", "__eq", "__neq", "__exists", "__in"] as const;
type Operator = (typeof OPERATORS)[number];

function parseKey(rawKey: string): { key: string; op: Operator | "__eq" } {
  for (const suffix of OPERATORS) {
    if (rawKey.endsWith(suffix)) {
      return { key: rawKey.slice(0, -suffix.length), op: suffix };
    }
  }
  return { key: rawKey, op: "__eq" };
}

/**
 * Evaluates a flat JSON predicate against a user's attributes and computed keys.
 * All conditions are AND-ed. An empty predicate matches every user.
 * Computed keys take precedence over attributes of the same name.
 */
export function evaluateTargetFilter(
  filter: Record<string, unknown>,
  user: { attributes: Record<string, unknown>; computed: ComputedUserKeys }
): boolean {
  const merged: Record<string, unknown> = { ...user.attributes, ...user.computed };

  for (const [rawKey, expected] of Object.entries(filter)) {
    const { key, op } = parseKey(rawKey);
    const actual = merged[key];

    switch (op) {
      case "__gte":
        if (typeof actual !== "number" || typeof expected !== "number") return false;
        if (actual < expected) return false;
        break;
      case "__lte":
        if (typeof actual !== "number" || typeof expected !== "number") return false;
        if (actual > expected) return false;
        break;
      case "__gt":
        if (typeof actual !== "number" || typeof expected !== "number") return false;
        if (actual <= expected) return false;
        break;
      case "__lt":
        if (typeof actual !== "number" || typeof expected !== "number") return false;
        if (actual >= expected) return false;
        break;
      case "__eq":
        if (actual !== expected) return false;
        break;
      case "__neq":
        if (actual === expected) return false;
        break;
      case "__exists":
        if (expected === true && (actual === undefined || actual === null)) return false;
        if (expected === false && actual !== undefined && actual !== null) return false;
        break;
      case "__in":
        if (!Array.isArray(expected)) return false;
        if (!expected.includes(actual)) return false;
        break;
    }
  }

  return true;
}
