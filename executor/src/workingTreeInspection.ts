import type { RunGit } from "./gitProcess";

export type WorkingTreeStatus = "clean" | "changes_detected";

export type InspectWorkingTreeOutcome =
  | { ok: true; status: WorkingTreeStatus }
  | {
      ok: false;
      reason: "status_failed";
      /** The failing git command's exit code (e.g. 128) or spawn error code (e.g. "ENOENT") —
       * never the command's stderr, which may contain unsafe content. Safe to log. */
      gitErrorCode: number | string | null;
    };

export interface InspectWorkingTreeRequest {
  /** The still-live materialised workspace path from a successful `materializeRepositoryWorkspace` call. */
  workspacePath: string;
}

/** The shape `runExecutor` depends on: `runGit` is bound once at composition time (see `main.ts`), not per call. */
export type InspectWorkingTree = (request: InspectWorkingTreeRequest) => Promise<InspectWorkingTreeOutcome>;

export interface InspectWorkingTreeParams extends InspectWorkingTreeRequest {
  runGit: RunGit;
}

/**
 * Classifies the materialised workspace's Git working tree as `clean` or `changes_detected` using
 * `git status --porcelain=v1` — a stable, machine-readable status format where both tracked
 * modifications and untracked files each produce a non-empty output line, unlike the
 * human-readable default format. Never inspects, returns, or logs the changed paths or any diff
 * content; only whether the porcelain output was empty.
 */
export async function inspectWorkingTree({
  workspacePath,
  runGit,
}: InspectWorkingTreeParams): Promise<InspectWorkingTreeOutcome> {
  const statusOutcome = await runGit({ args: ["status", "--porcelain=v1"], cwd: workspacePath });
  if (!statusOutcome.ok) {
    return { ok: false, reason: "status_failed", gitErrorCode: statusOutcome.code };
  }
  return { ok: true, status: statusOutcome.stdout.trim().length === 0 ? "clean" : "changes_detected" };
}
