import { describe, it, expect } from "bun:test";

// ─── Types (mirror component) ───────────────────────────────────────────────

type SendRow = {
  id: string;
  userId: string;
  channel: string;
  sentAt: string;
  scheduledFor: string | null;
  brazeScheduleId: string | null;
  variantId: string | null;
  variantName: string | null;
  variantTitle: string | null;
  variantBody: string;
  variantDeeplink: string | null;
  brazeSendId: string | null;
  personaName: string | null;
  personaColor: string | null;
  conversionAt: string | null;
  reward: number | null;
  decisionContext: unknown | null;
  failed: boolean;
};

type SortField = "sentAt" | "channel" | "persona" | "variant";
type SortDir = "asc" | "desc";

type Filters = {
  status: "all" | "success" | "failed" | "converted" | "pending";
  channel: string;
  persona: string;
};

type GroupedRows = { dateKey: string; label: string; rows: SendRow[] }[];

// ─── Pure functions extracted from agent-sends-table.tsx ────────────────────
// Copied verbatim so tests remain independent of the module boundary.

function formatShortTime(isoStr: string): string {
  const h = new Date(isoStr).getUTCHours();
  const m = new Date(isoStr).getUTCMinutes();
  const suffix = h >= 12 ? "pm" : "am";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour12}${suffix}` : `${hour12}:${String(m).padStart(2, "0")}${suffix}`;
}

function applyFilters(rows: SendRow[], filters: Filters, nowMs: number): SendRow[] {
  return rows.filter((r) => {
    if (filters.status === "success" && r.failed) return false;
    if (filters.status === "failed" && !r.failed) return false;
    if (filters.status === "converted" && !r.conversionAt) return false;
    if (filters.status === "pending" && !(r.scheduledFor && r.scheduledFor > new Date(nowMs).toISOString())) return false;
    if (filters.channel !== "all" && r.channel !== filters.channel) return false;
    if (filters.persona !== "all" && (r.personaName ?? "none") !== filters.persona) return false;
    return true;
  });
}

function applySortToGroups(groups: GroupedRows, field: SortField, dir: SortDir): GroupedRows {
  if (field === "sentAt") {
    return dir === "asc" ? [...groups].reverse() : groups;
  }
  return groups.map((g) => ({
    ...g,
    rows: [...g.rows].sort((a, b) => {
      let av = "";
      let bv = "";
      if (field === "channel") { av = a.channel; bv = b.channel; }
      if (field === "persona") { av = a.personaName ?? ""; bv = b.personaName ?? ""; }
      if (field === "variant") { av = a.variantName ?? ""; bv = b.variantName ?? ""; }
      return dir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    }),
  }));
}

// ─── Fixture helpers ─────────────────────────────────────────────────────────

function makeRow(overrides: Partial<SendRow> = {}): SendRow {
  return {
    id: "row-1",
    userId: "usr-1",
    channel: "push",
    sentAt: "2024-05-10T08:00:00.000Z",
    scheduledFor: null,
    brazeScheduleId: null,
    variantId: "v-1",
    variantName: "V1",
    variantTitle: null,
    variantBody: "Hello",
    variantDeeplink: null,
    brazeSendId: null,
    personaName: "Seekers",
    personaColor: "blue",
    conversionAt: null,
    reward: null,
    decisionContext: null,
    failed: false,
    ...overrides,
  };
}

// ─── formatShortTime ─────────────────────────────────────────────────────────

describe("formatShortTime", () => {
  it("renders midnight as 12am", () => {
    expect(formatShortTime("2024-01-01T00:00:00.000Z")).toBe("12am");
  });

  it("renders noon as 12pm", () => {
    expect(formatShortTime("2024-01-01T12:00:00.000Z")).toBe("12pm");
  });

  it("renders 8am correctly", () => {
    expect(formatShortTime("2024-01-01T08:00:00.000Z")).toBe("8am");
  });

  it("renders 1pm (13:00 UTC) correctly", () => {
    expect(formatShortTime("2024-01-01T13:00:00.000Z")).toBe("1pm");
  });

  it("renders 11pm (23:00 UTC) correctly", () => {
    expect(formatShortTime("2024-01-01T23:00:00.000Z")).toBe("11pm");
  });

  it("renders 11am (11:00 UTC) correctly", () => {
    expect(formatShortTime("2024-01-01T11:00:00.000Z")).toBe("11am");
  });

  it("includes minutes when non-zero (e.g. 8:30am)", () => {
    expect(formatShortTime("2024-01-01T08:30:00.000Z")).toBe("8:30am");
  });

  it("pads single-digit minutes with a leading zero (e.g. 8:05am)", () => {
    expect(formatShortTime("2024-01-01T08:05:00.000Z")).toBe("8:05am");
  });

  it("handles 12:30pm correctly", () => {
    expect(formatShortTime("2024-01-01T12:30:00.000Z")).toBe("12:30pm");
  });

  it("handles 3:15pm correctly (15:15 UTC)", () => {
    expect(formatShortTime("2024-01-01T15:15:00.000Z")).toBe("3:15pm");
  });
});

// ─── applyFilters ─────────────────────────────────────────────────────────────

describe("applyFilters", () => {
  const success = makeRow({ id: "s1", failed: false, conversionAt: null });
  const failed  = makeRow({ id: "f1", failed: true,  conversionAt: null });
  const converted = makeRow({ id: "c1", failed: false, conversionAt: "2024-05-10T09:00:00.000Z" });
  const emailRow = makeRow({ id: "e1", channel: "email", failed: false });
  const noPersona = makeRow({ id: "np1", personaName: null, failed: false });
  const rows = [success, failed, converted, emailRow, noPersona];

  const allFilters: Filters = { status: "all", channel: "all", persona: "all" };
  const nowMs = 1715382000000; // 2024-05-10T08:00:00.000Z

  it("returns all rows when all filters are 'all'", () => {
    expect(applyFilters(rows, allFilters, nowMs)).toHaveLength(rows.length);
  });

  it("status=success excludes failed rows", () => {
    const result = applyFilters(rows, { ...allFilters, status: "success" }, nowMs);
    expect(result.every((r) => !r.failed)).toBe(true);
    expect(result.find((r) => r.id === "f1")).toBeUndefined();
  });

  it("status=failed excludes non-failed rows", () => {
    const result = applyFilters(rows, { ...allFilters, status: "failed" }, nowMs);
    expect(result.every((r) => r.failed)).toBe(true);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("f1");
  });

  it("status=converted excludes rows without conversionAt", () => {
    const result = applyFilters(rows, { ...allFilters, status: "converted" }, nowMs);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("c1");
  });

  it("status=pending includes only rows with scheduledFor in the future", () => {
    const now = Date.now();
    const future = new Date(now + 3600000).toISOString(); // 1 hour from now
    const past = new Date(now - 3600000).toISOString();   // 1 hour ago
    const pendingRow = makeRow({ id: "pend1", scheduledFor: future, failed: false });
    const pastRow = makeRow({ id: "past1", scheduledFor: past, failed: false });
    const noschedule = makeRow({ id: "nosched1", scheduledFor: null, failed: false });
    const testRows = [pendingRow, pastRow, noschedule];
    const result = applyFilters(testRows, { ...allFilters, status: "pending" }, now);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("pend1");
  });

  it("channel filter matches exact channel name", () => {
    const result = applyFilters(rows, { ...allFilters, channel: "email" }, nowMs);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("e1");
  });

  it("channel=all passes all channels through", () => {
    const result = applyFilters(rows, { ...allFilters, channel: "all" }, nowMs);
    expect(result).toHaveLength(rows.length);
  });

  it("persona filter matches exact persona name", () => {
    const result = applyFilters(rows, { ...allFilters, persona: "Seekers" }, nowMs);
    // success, failed, converted, email all have personaName="Seekers"; noPersona does not
    expect(result.every((r) => r.personaName === "Seekers")).toBe(true);
    expect(result.find((r) => r.id === "np1")).toBeUndefined();
  });

  it("persona='none' matches rows with null personaName", () => {
    const result = applyFilters(rows, { ...allFilters, persona: "none" }, nowMs);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("np1");
  });

  it("combines status and channel filters", () => {
    const result = applyFilters(rows, { ...allFilters, status: "success", channel: "email" }, nowMs);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("e1");
  });

  it("returns empty array when no rows match", () => {
    const result = applyFilters(rows, { ...allFilters, channel: "sms" }, nowMs);
    expect(result).toHaveLength(0);
  });
});

// ─── applySortToGroups ───────────────────────────────────────────────────────

describe("applySortToGroups", () => {
  function makeGroup(dateKey: string, rows: SendRow[]): GroupedRows[number] {
    return { dateKey, label: dateKey, rows };
  }

  const rowA = makeRow({ id: "a", channel: "email", personaName: "Alpha", variantName: "V1" });
  const rowB = makeRow({ id: "b", channel: "push",  personaName: "Beta",  variantName: "V2" });
  const rowC = makeRow({ id: "c", channel: "sms",   personaName: "Zeta",  variantName: "V3" });

  const groups: GroupedRows = [
    makeGroup("2024-05-10", [rowC, rowA]),
    makeGroup("2024-05-09", [rowB]),
    makeGroup("2024-05-08", [rowA]),
  ];

  describe("sentAt field", () => {
    it("desc returns groups in original order", () => {
      const result = applySortToGroups(groups, "sentAt", "desc");
      expect(result.map((g) => g.dateKey)).toEqual(["2024-05-10", "2024-05-09", "2024-05-08"]);
    });

    it("asc reverses group order", () => {
      const result = applySortToGroups(groups, "sentAt", "asc");
      expect(result.map((g) => g.dateKey)).toEqual(["2024-05-08", "2024-05-09", "2024-05-10"]);
    });

    it("does not mutate original groups array", () => {
      const original = [...groups];
      applySortToGroups(groups, "sentAt", "asc");
      expect(groups.map((g) => g.dateKey)).toEqual(original.map((g) => g.dateKey));
    });
  });

  describe("channel field", () => {
    it("asc sorts rows alphabetically by channel within each group", () => {
      const result = applySortToGroups(groups, "channel", "asc");
      expect(result[0].rows.map((r) => r.channel)).toEqual(["email", "sms"]);
    });

    it("desc sorts rows reverse-alphabetically by channel", () => {
      const result = applySortToGroups(groups, "channel", "desc");
      expect(result[0].rows.map((r) => r.channel)).toEqual(["sms", "email"]);
    });

    it("does not change group order", () => {
      const result = applySortToGroups(groups, "channel", "asc");
      expect(result.map((g) => g.dateKey)).toEqual(["2024-05-10", "2024-05-09", "2024-05-08"]);
    });
  });

  describe("persona field", () => {
    it("asc sorts rows by personaName ascending", () => {
      const result = applySortToGroups(groups, "persona", "asc");
      expect(result[0].rows.map((r) => r.personaName)).toEqual(["Alpha", "Zeta"]);
    });

    it("desc sorts rows by personaName descending", () => {
      const result = applySortToGroups(groups, "persona", "desc");
      expect(result[0].rows.map((r) => r.personaName)).toEqual(["Zeta", "Alpha"]);
    });

    it("null personaName sorts as empty string (before 'A' in asc)", () => {
      const noPersonaRow = makeRow({ id: "np", personaName: null, channel: "push" });
      const g: GroupedRows = [makeGroup("2024-05-10", [rowA, noPersonaRow])];
      const result = applySortToGroups(g, "persona", "asc");
      expect(result[0].rows[0].personaName).toBeNull();
    });
  });

  describe("variant field", () => {
    it("asc sorts rows by variantName ascending", () => {
      const result = applySortToGroups(groups, "variant", "asc");
      expect(result[0].rows.map((r) => r.variantName)).toEqual(["V1", "V3"]);
    });

    it("desc sorts rows by variantName descending", () => {
      const result = applySortToGroups(groups, "variant", "desc");
      expect(result[0].rows.map((r) => r.variantName)).toEqual(["V3", "V1"]);
    });
  });
});

// ─── filtersActive ───────────────────────────────────────────────────────────

// Copied verbatim from agent-sends-table.tsx (line 402) so tests remain
// independent of the module boundary.
function filtersActive(f: Filters): boolean {
  return f.status !== "all" || f.channel !== "all" || f.persona !== "all";
}

describe("filtersActive", () => {
  it("returns false when all filters are 'all' (default state)", () => {
    const filters: Filters = { status: "all", channel: "all", persona: "all" };
    expect(filtersActive(filters)).toBe(false);
  });

  it("returns true when status is non-'all'", () => {
    const filters: Filters = { status: "failed", channel: "all", persona: "all" };
    expect(filtersActive(filters)).toBe(true);
  });

  it("returns true when channel is non-'all'", () => {
    const filters: Filters = { status: "all", channel: "push", persona: "all" };
    expect(filtersActive(filters)).toBe(true);
  });

  it("returns true when persona is non-'all'", () => {
    const filters: Filters = { status: "all", channel: "all", persona: "Seekers" };
    expect(filtersActive(filters)).toBe(true);
  });

  it("returns true when multiple filters are non-'all'", () => {
    const filters: Filters = { status: "converted", channel: "email", persona: "Seekers" };
    expect(filtersActive(filters)).toBe(true);
  });

  it("empty rows with active filter does not trigger empty-state guard", () => {
    const filters: Filters = { status: "failed", channel: "all", persona: "all" };
    const rows: SendRow[] = [];
    // The guard at component line 525: if (rows.length === 0 && !filtersActive(filters))
    // must be FALSE when a filter is active, to preserve filter UI
    expect(rows.length === 0 && !filtersActive(filters)).toBe(false);
  });
});
