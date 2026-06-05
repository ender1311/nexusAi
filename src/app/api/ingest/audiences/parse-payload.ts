export type CohortChange = {
  user_ids?: string[];
  user_id?: string;
  external_user_id?: string;
  braze_user_ids?: string[];
  braze_user_id?: string;
  braze_user_id_latest?: string;
  braze_id?: string;
};

export type ParsedAudiencePayload = {
  cohortId: string;
  externalIds: string[];
  brazeIds: string[];
};

function trimId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function idsFromRow(row: Record<string, unknown>): { external: string[]; braze: string[] } {
  const external: string[] = [];
  const braze: string[] = [];

  if (Array.isArray(row.user_ids)) {
    external.push(...row.user_ids.map(trimId).filter((id) => id.length > 0));
  }

  const externalSingular = trimId(row.user_id ?? row.external_user_id);
  if (externalSingular) external.push(externalSingular);

  if (Array.isArray(row.braze_user_ids)) {
    braze.push(...row.braze_user_ids.map(trimId).filter((id) => id.length > 0));
  }

  const brazeSingular = trimId(
    row.braze_user_id ?? row.braze_user_id_latest ?? row.braze_id,
  );
  if (brazeSingular) braze.push(brazeSingular);

  return { external, braze };
}

function mergeRows(rows: Record<string, unknown>[]): { external: string[]; braze: string[] } {
  const external: string[] = [];
  const braze: string[] = [];
  for (const row of rows) {
    const ids = idsFromRow(row);
    external.push(...ids.external);
    braze.push(...ids.braze);
  }
  return { external, braze };
}

function resolveCohortId(
  topLevel: unknown,
  rows: Record<string, unknown>[],
): string | null {
  const fromTop = trimId(topLevel);
  if (fromTop) return fromTop;

  const fromRows = rows.map((row) => trimId(row.cohort_id)).filter((id) => id.length > 0);
  if (fromRows.length === 0) return null;

  const unique = [...new Set(fromRows)];
  if (unique.length > 1) {
    return null;
  }
  return unique[0] ?? null;
}

export function parseAudiencePayload(
  body: unknown,
):
  | { ok: true; payload: ParsedAudiencePayload }
  | { ok: false; error: string } {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Invalid payload: expected an object" };
  }

  if (Array.isArray(body)) {
    const rows = body as Record<string, unknown>[];
    const cohortId = resolveCohortId(undefined, rows);
    if (!cohortId) {
      return {
        ok: false,
        error:
          "Invalid payload: cohort_id must be a non-empty string (top-level or on each row)",
      };
    }
    const { external, braze } = mergeRows(rows);
    if (external.length + braze.length === 0) {
      return {
        ok: false,
        error: "Invalid payload: expected user_id, user_ids, or braze_user_id fields",
      };
    }
    return { ok: true, payload: { cohortId, externalIds: external, brazeIds: braze } };
  }

  const raw = body as Record<string, unknown>;

  if (Array.isArray(raw.cohort_changes)) {
    const cohortId = trimId(raw.cohort_id);
    if (!cohortId) {
      return { ok: false, error: "Invalid payload: cohort_id must be a non-empty string" };
    }
    const { external, braze } = mergeRows(raw.cohort_changes as Record<string, unknown>[]);
    return { ok: true, payload: { cohortId, externalIds: external, brazeIds: braze } };
  }

  const rowSources: Record<string, unknown>[] = [];
  if (Array.isArray(raw.users)) rowSources.push(...(raw.users as Record<string, unknown>[]));
  if (Array.isArray(raw.rows)) rowSources.push(...(raw.rows as Record<string, unknown>[]));

  const cohortId = resolveCohortId(raw.cohort_id, rowSources);
  if (!cohortId) {
    return { ok: false, error: "Invalid payload: cohort_id must be a non-empty string" };
  }

  if (rowSources.length > 0) {
    const { external, braze } = mergeRows(rowSources);
    if (external.length + braze.length === 0) {
      return {
        ok: false,
        error: "Invalid payload: expected user_id, user_ids, or braze_user_id fields",
      };
    }
    return { ok: true, payload: { cohortId, externalIds: external, brazeIds: braze } };
  }

  const flat = idsFromRow(raw);
  if (flat.external.length + flat.braze.length > 0) {
    return {
      ok: true,
      payload: { cohortId, externalIds: flat.external, brazeIds: flat.braze },
    };
  }

  return {
    ok: false,
    error:
      "Invalid payload: expected cohort_changes, users, rows, or user_id with cohort_id",
  };
}
