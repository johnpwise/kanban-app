import { cookies } from "next/headers";
import Link from "next/link";
import { ArrowRight, Info, LayoutDashboard } from "lucide-react";

import ModeToggle from "@/components/mode-toggle/ModeToggle";
import { getBoard } from "@/lib/services/board";
import { getGreeting } from "@/lib/services/greeting";
import { DARK_MODE_COOKIE_KEY, parseDarkModeCookie } from "@/store/appStore";

import { HOME_PAGE_TEST_IDS } from "./HomePage.testIds";

export default async function HomePage() {
  const [greeting, board, cookieStore] = await Promise.all([getGreeting(), getBoard(), cookies()]);
  const cardCount = Object.keys(board.cardsById).length;
  const isDarkMode = parseDarkModeCookie(cookieStore.get(DARK_MODE_COOKIE_KEY)?.value);

  return (
    <main className="space-y-8">
      <header className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-widest text-indigo-600 dark:text-indigo-400">
          Welcome
        </p>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">Home</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">{greeting}</p>
      </header>

      <ModeToggle initialIsDarkMode={isDarkMode} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Link
          href="/about"
          className="group flex items-center justify-between gap-3 rounded-2xl border border-slate-200/70 bg-white/80 p-5 shadow-sm backdrop-blur transition-all hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-lg dark:border-slate-800 dark:bg-slate-900/60 dark:hover:border-indigo-800"
        >
          <span className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-100 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400">
              <Info className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">About this app</span>
          </span>
          <ArrowRight
            className="h-4 w-4 text-slate-400 transition-transform group-hover:translate-x-1 group-hover:text-indigo-500"
            aria-hidden="true"
          />
        </Link>

        <Link
          href="/board"
          className="group flex items-center justify-between gap-3 rounded-2xl border border-slate-200/70 bg-white/80 p-5 shadow-sm backdrop-blur transition-all hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-lg dark:border-slate-800 dark:bg-slate-900/60 dark:hover:border-indigo-800"
        >
          <span className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-100 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400">
              <LayoutDashboard className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
              Kanban board demo
              <span
                data-id={HOME_PAGE_TEST_IDS.boardCardCount}
                className="rounded-full bg-indigo-600 px-2 py-0.5 text-xs font-semibold text-white"
              >
                {cardCount} {cardCount === 1 ? "card" : "cards"}
              </span>
            </span>
          </span>
          <ArrowRight
            className="h-4 w-4 text-slate-400 transition-transform group-hover:translate-x-1 group-hover:text-indigo-500"
            aria-hidden="true"
          />
        </Link>
      </div>
    </main>
  );
}
