import Link from "next/link";
import { ArrowLeft, Code2 } from "lucide-react";

import { getBoard } from "@/lib/services/board";

import KanbanBoard from "@/components/kanban-board/KanbanBoard";
import LabelFilter from "@/components/label-filter/LabelFilter";

import { BOARD_PAGE_TEST_IDS } from "./BoardPage.testIds";

export default async function BoardPage() {
  const board = await getBoard();

  return (
    <main className="space-y-6">
      <header className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-widest text-indigo-600 dark:text-indigo-400">
          Workspace
        </p>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">Board</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Drag a card between columns, or use its “Move to” control.
        </p>
      </header>
      <LabelFilter />
      <KanbanBoard initialBoard={board} />
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-slate-200/70 pt-4 dark:border-slate-800">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 transition-colors hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back home
        </Link>
        <a
          href="/api/board"
          target="_blank"
          rel="noopener noreferrer"
          data-id={BOARD_PAGE_TEST_IDS.rawApiLink}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 transition-colors hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
        >
          <Code2 className="h-4 w-4" aria-hidden="true" />
          View raw API response
        </a>
      </div>
    </main>
  );
}
