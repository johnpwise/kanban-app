import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { RunGit } from "./gitProcess";

export interface MaterializedRepositoryWorkspace {
  path: string;
  headSha: string;
}

export type MaterializeRepositoryWorkspaceOutcome =
  | { ok: true; workspace: MaterializedRepositoryWorkspace; cleanup: () => Promise<void> }
  | { ok: false; reason: "workspace_create_failed" | "clone_failed" | "checkout_failed" };

export interface RepositoryWorkspaceRequest {
  /** Already-validated `owner/repo` from the immutable execution run input. */
  repository: string;
  /** Already-validated branch name from the immutable execution run input. Authoritative — no fallback. */
  baseBranch: string;
}

/** The shape `runExecutor` depends on: `runGit`/`buildCloneUrl` are bound once at composition time (see `main.ts`), not per call. */
export type MaterializeRepositoryWorkspace = (
  request: RepositoryWorkspaceRequest,
) => Promise<MaterializeRepositoryWorkspaceOutcome>;

export interface MaterializeRepositoryWorkspaceParams extends RepositoryWorkspaceRequest {
  runGit: RunGit;
  /**
   * Builds the clone source from `repository`. Defaults to the real public GitHub HTTPS URL;
   * overridable only so tests can point at a local repository path instead of the network — the
   * production path always takes the default.
   */
  buildCloneUrl?: (repository: string) => string;
}

const defaultBuildCloneUrl = (repository: string): string => `https://github.com/${repository}.git`;

/**
 * Materialises `repository`@`baseBranch` into a fresh ephemeral local workspace: creates a temp
 * directory, clones, explicitly checks out the requested branch (never whatever the clone's
 * default branch happened to be), and verifies the result. Only ever runs the fixed git
 * subcommands below — nothing from the cloned repository's own content (scripts, hooks) is
 * executed. Any failure removes the partial workspace before returning, so a failed call never
 * leaves cloned content or an orphaned temp directory behind.
 *
 * The branch checkout uses `git checkout -B <baseBranch> refs/remotes/origin/<baseBranch>` rather
 * than passing the branch as a bare positional argument: `<baseBranch>` is consumed as the
 * mandatory value of `-B` (argv option-value consumption, immune to a leading `-`), and the second
 * reference is always prefixed by the literal `refs/remotes/origin/`, so the resulting token can
 * never itself be interpreted as a git flag — closing the argument-injection gap that argv-array
 * (shell-free) execution alone does not close.
 */
export async function materializeRepositoryWorkspace({
  repository,
  baseBranch,
  runGit,
  buildCloneUrl = defaultBuildCloneUrl,
}: MaterializeRepositoryWorkspaceParams): Promise<MaterializeRepositoryWorkspaceOutcome> {
  let workspacePath: string;
  try {
    workspacePath = await mkdtemp(join(tmpdir(), "ada-executor-"));
  } catch {
    return { ok: false, reason: "workspace_create_failed" };
  }

  const cloneOutcome = await runGit({ args: ["clone", buildCloneUrl(repository), workspacePath] });
  if (!cloneOutcome.ok) {
    await rm(workspacePath, { recursive: true, force: true });
    return { ok: false, reason: "clone_failed" };
  }

  const checkoutOutcome = await runGit({
    args: ["checkout", "-B", baseBranch, `refs/remotes/origin/${baseBranch}`],
    cwd: workspacePath,
  });
  if (!checkoutOutcome.ok) {
    await rm(workspacePath, { recursive: true, force: true });
    return { ok: false, reason: "checkout_failed" };
  }

  const [branchOutcome, shaOutcome] = await Promise.all([
    runGit({ args: ["rev-parse", "--abbrev-ref", "HEAD"], cwd: workspacePath }),
    runGit({ args: ["rev-parse", "HEAD"], cwd: workspacePath }),
  ]);
  const checkedOutBranch = branchOutcome.ok ? branchOutcome.stdout.trim() : undefined;
  if (!branchOutcome.ok || !shaOutcome.ok || checkedOutBranch !== baseBranch) {
    await rm(workspacePath, { recursive: true, force: true });
    return { ok: false, reason: "checkout_failed" };
  }

  return {
    ok: true,
    workspace: { path: workspacePath, headSha: shaOutcome.stdout.trim() },
    cleanup: () => rm(workspacePath, { recursive: true, force: true }),
  };
}
