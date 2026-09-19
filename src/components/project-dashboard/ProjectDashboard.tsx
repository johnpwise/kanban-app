"use client";

import { useActionState } from "react";
import Link from "next/link";
import { ArrowRight, FolderKanban, Plus, XCircle } from "lucide-react";

import { createProjectAction, type CreateProjectActionState } from "@/actions/createProject";

import type { Project } from "@/schemas/project";

import { PROJECT_DASHBOARD_TEST_IDS } from "./ProjectDashboard.testIds";

interface ProjectDashboardProps {
  projects: Project[];
  loadError?: string;
}

const initialState: CreateProjectActionState = { status: "idle" };

export default function ProjectDashboard({ projects, loadError }: ProjectDashboardProps) {
  const [state, formAction, isPending] = useActionState(createProjectAction, initialState);
  const hasActionError = state.status === "error";

  return (
    <section aria-labelledby="projects-heading" className="space-y-5">
      <div className="space-y-1">
        <h2 id="projects-heading" className="text-xl font-bold text-slate-900 dark:text-white">
          Projects
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Keep boards and their cards separate.
        </p>
      </div>

      <form
        action={formAction}
        data-id={PROJECT_DASHBOARD_TEST_IDS.form}
        className="flex flex-col gap-3 rounded-2xl border border-slate-200/70 bg-white/80 p-5 shadow-sm sm:flex-row sm:items-end dark:border-slate-800 dark:bg-slate-900/60"
      >
        <div className="flex-1 space-y-1.5">
          <label htmlFor="project-name" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            Project name
          </label>
          <input
            id="project-name"
            name="name"
            required
            maxLength={80}
            disabled={isPending}
            aria-invalid={hasActionError}
            aria-describedby={hasActionError ? "project-create-status" : undefined}
            data-id={PROJECT_DASHBOARD_TEST_IDS.nameInput}
            className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900"
            placeholder="e.g. Website launch"
          />
        </div>
        <button
          type="submit"
          disabled={isPending}
          data-id={PROJECT_DASHBOARD_TEST_IDS.submit}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          {isPending ? "Creating project…" : "Create project"}
        </button>
      </form>

      {(hasActionError || loadError) && (
        <p
          id={hasActionError ? "project-create-status" : undefined}
          role="status"
          data-id={PROJECT_DASHBOARD_TEST_IDS.status}
          className="flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-500/10 dark:text-red-400"
        >
          <XCircle className="h-4 w-4" aria-hidden="true" />
          {state.message ?? loadError}
        </p>
      )}

      {!loadError && projects.length === 0 ? (
        <div
          data-id={PROJECT_DASHBOARD_TEST_IDS.empty}
          className="rounded-2xl border border-dashed border-slate-300 px-5 py-10 text-center dark:border-slate-700"
        >
          <FolderKanban className="mx-auto h-8 w-8 text-slate-400" aria-hidden="true" />
          <h3 className="mt-3 font-semibold text-slate-800 dark:text-slate-100">No projects yet</h3>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Create your first project above.</p>
        </div>
      ) : (
        <ul data-id={PROJECT_DASHBOARD_TEST_IDS.list} className="grid gap-4 sm:grid-cols-2">
          {projects.map((project) => (
            <li key={project.id}>
              <Link
                href={`/projects/${project.id}`}
                className="group flex items-center justify-between gap-3 rounded-2xl border border-slate-200/70 bg-white/80 p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-800 dark:bg-slate-900/60 dark:hover:border-indigo-800"
              >
                <span className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-100 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400">
                    <FolderKanban className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">{project.name}</span>
                </span>
                <ArrowRight className="h-4 w-4 text-slate-400 transition-transform group-hover:translate-x-1" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
