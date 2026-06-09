"use client";

import { useState } from "react";
import { X } from "lucide-react";
import type { ValueCount } from "@/lib/segments/facet-types";
import { filterFacetValues } from "@/lib/segments/facet-filter";
import { formatFacetValueLabel } from "@/lib/segments/facet-labels";

type Props = {
  fieldId: string;
  values: ValueCount[];
  multi: boolean;
  selected: string[];
  onChange: (next: string[]) => void;
};

export function ValueCombobox({ fieldId, values, multi, selected, onChange }: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const matches = filterFacetValues(values, query, fieldId);
  const exact = query.trim() !== "" && values.some((v) => v.value === query.trim());

  function commit(value: string) {
    if (multi) {
      if (!selected.includes(value)) onChange([...selected, value]);
    } else {
      onChange([value]);
    }
    setQuery("");
    setOpen(false);
  }

  function removeChip(value: string) {
    onChange(selected.filter((v) => v !== value));
  }

  const inputClass = "rounded border bg-background px-2 py-1 text-sm";

  return (
    <div className="relative inline-flex flex-col gap-1">
      {multi && selected.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selected.map((v) => (
            <span key={v} className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs">
              {v}
              <button onClick={() => removeChip(v)} aria-label={`Remove ${v}`}>
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        role="combobox"
        aria-expanded={open}
        aria-label="Value"
        className={inputClass}
        value={multi ? query : (query !== "" ? query : selected[0] ?? "")}
        placeholder={multi ? "search values…" : "select or type…"}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
      />
      {open && (
        <ul className="absolute top-full z-10 mt-1 max-h-56 w-64 overflow-auto rounded border bg-background shadow">
          {matches.map((m) => (
            <li key={m.value}>
              <button
                type="button"
                className="block w-full px-2 py-1 text-left text-sm hover:bg-muted"
                onClick={() => commit(m.value)}
              >
                {formatFacetValueLabel(fieldId, m.value, m.count)}
              </button>
            </li>
          ))}
          {query.trim() !== "" && !exact && (
            <li>
              <button
                type="button"
                className="block w-full px-2 py-1 text-left text-sm italic text-muted-foreground hover:bg-muted"
                onClick={() => commit(query.trim())}
              >
                Use {'"'}{query.trim()}{'"'}
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
