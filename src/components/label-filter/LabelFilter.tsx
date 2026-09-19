"use client";

import type { ChangeEvent } from "react";
import { Filter } from "lucide-react";

import { useBoardFilterStore } from "@/store/boardFilterStore";

import type { CardLabel } from "@/schemas/board";

import { LABEL_FILTER_TEST_IDS } from "./LabelFilter.testIds";

const LABEL_OPTIONS: { value: CardLabel | "all"; label: string }[] = [
  { value: "all", label: "All labels" },
  { value: "bug", label: "Bug" },
  { value: "feature", label: "Feature" },
  { value: "chore", label: "Chore" },
];

export default function LabelFilter() {
  const activeLabel = useBoardFilterStore((state) => state.activeLabel);
  const setActiveLabel = useBoardFilterStore((state) => state.setActiveLabel);

  function handleChange(event: ChangeEvent<HTMLSelectElement>) {
    const value = event.target.value;
    setActiveLabel(value === "all" ? null : (value as CardLabel));
  }

  return (
    <div className="flex items-center gap-2">
      <label
        htmlFor="label-filter"
        className="flex items-center gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-300"
      >
        <Filter className="h-4 w-4 text-slate-400" aria-hidden="true" />
        Filter by label
      </label>
      <select
        id="label-filter"
        data-id={LABEL_FILTER_TEST_IDS.select}
        value={activeLabel ?? "all"}
        onChange={handleChange}
        className="rounded-lg border-slate-300 py-1.5 pl-3 text-sm shadow-sm transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 dark:border-slate-700 dark:bg-slate-900"
      >
        {LABEL_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
