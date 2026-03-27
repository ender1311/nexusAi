"use client";

import { useState } from "react";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { YOUVERSION_DEEPLINKS } from "@/lib/constants/youversion";

const CUSTOM_VALUE = "__custom__";

interface DeeplinkSelectProps {
  value: string;
  onChange: (value: string) => void;
}

export function DeeplinkSelect({ value, onChange }: DeeplinkSelectProps) {
  const isPreset = YOUVERSION_DEEPLINKS.some((d) => d.value === value);
  const [showCustom, setShowCustom] = useState(!isPreset && value !== "");

  const categories = Array.from(new Set(YOUVERSION_DEEPLINKS.map((d) => d.category)));

  const handleSelectChange = (val: string | null) => {
    if (val === CUSTOM_VALUE) {
      setShowCustom(true);
      onChange("");
    } else {
      setShowCustom(false);
      onChange(val ?? "");
    }
  };

  const selectValue = showCustom ? CUSTOM_VALUE : (value || "");

  return (
    <div className="space-y-2">
      <Select value={selectValue} onValueChange={handleSelectChange}>
        <SelectTrigger>
          <SelectValue placeholder="Select a deeplink..." />
        </SelectTrigger>
        <SelectContent>
          {categories.map((category) => (
            <SelectGroup key={category}>
              <SelectLabel>{category}</SelectLabel>
              {YOUVERSION_DEEPLINKS.filter((d) => d.category === category).map((d) => (
                <SelectItem key={d.value} value={d.value}>
                  {d.label}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
          <SelectGroup>
            <SelectLabel>Custom</SelectLabel>
            <SelectItem value={CUSTOM_VALUE}>Custom URL...</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
      {showCustom && (
        <Input
          placeholder="youversion://..."
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}
