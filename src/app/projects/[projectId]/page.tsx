import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ArrowLeft, Code2 } from "lucide-react";

import KanbanBoard from "@/components/kanban-board/KanbanBoard";
import { getBoard } from "@/lib/services/board";
import { getProject } from "@/lib/services/projects";
import { projectIdSchema } from "@/schemas/project";

import { PROJECT_BOARD_PAGE_TEST_IDS } from "./ProjectBoardPage.testIds";

interface ProjectBoardPageProps {
  params: Promise<{ projectId: string }>;
}

export default async function ProjectBoardPage({ params }: ProjectBoardPageProps) {
  await connection();
  const parsedProjectId = projectIdSchema.safeParse((await params).projectId);

  if (!parsedProjectId.success) {
    notFound();
  }

  const projectId = parsedProjectId.data;
  const [project, board] = await Promise.all([getProject(projectId), getBoard(projectId)]);

  if (!project || !board) {
    notFound();
  }

  return (
    <main className="space-y-6">
      <header className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-widest text-indigo-600 dark:text-indigo-400">
          Project board
        </p>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">{project.name}</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Drag a card between columns, or use its “Move to” control.
        </p>
      </header>
      <KanbanBoard key={projectId} projectId={projectId} initialBoard={board} />
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-slate-200/70 pt-4 dark:border-slate-800">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 transition-colors hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          All projects
        </Link>
        <a
          href={`/api/projects/${projectId}/board`}
          target="_blank"
          rel="noopener noreferrer"
          data-id={PROJECT_BOARD_PAGE_TEST_IDS.rawApiLink}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 transition-colors hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
        >
          <Code2 className="h-4 w-4" aria-hidden="true" />
          View raw API response
        </a>
      </div>
    </main>
  );
}
