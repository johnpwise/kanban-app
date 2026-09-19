"use client";

import { useState } from "react";
import { Moon, Sun } from "lucide-react";

import { persistDarkMode } from "@/store/appStore";

import { MODE_TOGGLE_TEST_IDS } from "./ModeToggle.testIds";

interface ModeToggleProps {
  initialIsDarkMode: boolean;
}

export default function ModeToggle({ initialIsDarkMode }: ModeToggleProps) {
  const [isDarkMode, setIsDarkMode] = useState(initialIsDarkMode);

  function toggleDarkMode() {
    const next = !isDarkMode;

    persistDarkMode(next);
    setIsDarkMode(next);
  }

  return (
    <section className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200/70 bg-white/80 p-4 shadow-sm backdrop-blur dark:border-slate-800 dark:bg-slate-900/60">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-100 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400">
          {isDarkMode ? <Moon className="h-4 w-4" aria-hidden="true" /> : <Sun className="h-4 w-4" aria-hidden="true" />}
        </span>
        <p
          data-id={MODE_TOGGLE_TEST_IDS.label}
          className="text-sm font-medium text-slate-700 dark:text-slate-300"
        >
          Mode is {isDarkMode ? "dark" : "light"}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={isDarkMode}
        aria-label="Toggle dark mode"
        data-id={MODE_TOGGLE_TEST_IDS.button}
        onClick={toggleDarkMode}
        className="relative inline-flex h-7 w-12 shrink-0 items-center rounded-full bg-slate-300 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:bg-slate-700 dark:focus-visible:ring-offset-slate-900 data-[checked=true]:bg-indigo-600"
        data-checked={isDarkMode}
      >
        <span
          className="inline-block h-5 w-5 translate-x-1 rounded-full bg-white shadow-sm transition-transform data-[checked=true]:translate-x-6"
          data-checked={isDarkMode}
        />
      </button>
    </section>
  );
}
