"use client";

import { useState, type ReactNode } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTaxonomy, type UICategory } from "./use-taxonomy";

export function ManageCategoriesSheet({ children }: { children: ReactNode }) {
  const { taxonomy, refresh } = useTaxonomy();
  const [error, setError] = useState<string | null>(null);
  const [newCategory, setNewCategory] = useState("");

  async function call(input: RequestInfo, init: RequestInit) {
    setError(null);
    const res = await fetch(input, { headers: { "Content-Type": "application/json" }, ...init });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? "Request failed");
      return false;
    }
    await refresh();
    return true;
  }

  async function addCategory() {
    if (!newCategory.trim()) return;
    if (await call("/api/push-library/categories", { method: "POST", body: JSON.stringify({ label: newCategory.trim() }) })) {
      setNewCategory("");
    }
  }

  return (
    <Sheet>
      <SheetTrigger render={<span />}>{children}</SheetTrigger>
      <SheetContent expandable className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader className="pr-20">
          <SheetTitle>Manage Categories</SheetTitle>
        </SheetHeader>
        {error && <p className="text-sm text-destructive px-4">{error}</p>}

        <div className="flex gap-2 px-4 my-4">
          <Input value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="New category label" />
          <Button onClick={addCategory}>Add</Button>
        </div>

        <div className="space-y-6 px-4 pb-6">
          {taxonomy.map((cat) => (
            <CategoryBlock key={cat.id} cat={cat} categories={taxonomy} onChange={refresh} onError={setError} />
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function CategoryBlock({
  cat, categories, onChange, onError,
}: {
  cat: UICategory;
  categories: UICategory[];
  onChange: () => Promise<void>;
  onError: (m: string | null) => void;
}) {
  const [label, setLabel] = useState(cat.label);
  const [newSub, setNewSub] = useState("");

  async function call(input: RequestInfo, init: RequestInit) {
    onError(null);
    const res = await fetch(input, { headers: { "Content-Type": "application/json" }, ...init });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      onError(j.error ?? "Request failed");
      return false;
    }
    await onChange();
    return true;
  }

  return (
    <div className="border rounded-lg p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input value={label} onChange={(e) => setLabel(e.target.value)} className="font-medium flex-1 min-w-[10rem]" />
        <Button size="sm" variant="outline" onClick={() => call(`/api/push-library/categories/${cat.id}`, { method: "PATCH", body: JSON.stringify({ label }) })}>Save</Button>
        <Button size="sm" variant="ghost" onClick={() => call(`/api/push-library/categories/${cat.id}`, { method: "PATCH", body: JSON.stringify({ isActive: !cat.isActive }) })}>{cat.isActive ? "Disable" : "Enable"}</Button>
        <Button size="sm" variant="destructive" onClick={() => call(`/api/push-library/categories/${cat.id}`, { method: "DELETE" })}>Delete</Button>
      </div>

      <div className="mt-3 sm:ml-4 space-y-2">
        {cat.subcategories.map((s) => (
          <div key={s.id} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="flex-1 min-w-[8rem]">{s.label}{!s.isActive && " (disabled)"}</span>
            <select defaultValue={s.deeplinkBehavior} onChange={(e) => call(`/api/push-library/subcategories/${s.id}`, { method: "PATCH", body: JSON.stringify({ deeplinkBehavior: e.target.value }) })} className="border rounded px-1 py-0.5 max-w-[10rem]">
              <option value="none">none</option>
              <option value="specific-verse">specific-verse</option>
            </select>
            <select defaultValue={cat.id} onChange={(e) => call(`/api/push-library/subcategories/${s.id}`, { method: "PATCH", body: JSON.stringify({ categoryId: e.target.value }) })} className="border rounded px-1 py-0.5 max-w-[10rem]">
              {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
            <Button size="sm" variant="ghost" onClick={() => call(`/api/push-library/subcategories/${s.id}`, { method: "PATCH", body: JSON.stringify({ isActive: !s.isActive }) })}>{s.isActive ? "Disable" : "Enable"}</Button>
            <Button size="sm" variant="destructive" onClick={() => call(`/api/push-library/subcategories/${s.id}`, { method: "DELETE" })}>Delete</Button>
          </div>
        ))}
        <div className="flex gap-2">
          <Input value={newSub} onChange={(e) => setNewSub(e.target.value)} placeholder="New subcategory label" className="h-8" />
          <Button size="sm" onClick={async () => { if (newSub.trim() && await call("/api/push-library/subcategories", { method: "POST", body: JSON.stringify({ categoryId: cat.id, label: newSub.trim() }) })) setNewSub(""); }}>Add</Button>
        </div>
      </div>
    </div>
  );
}
