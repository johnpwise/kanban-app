import type { RunGit } from "./gitProcess";

export type GitIntegrityOutcome =
  | { ok: true; status: "verified" }
  | {
      ok: false;
      reason: "head_changed";
      /** Safe git identifiers only — the persisted/expected SHA and the SHA actually found. */
      expectedHeadSha: string;
      actualHeadSha: string;
    }
  | {
      ok: false;
      reason: "branch_changed";
      /** Safe git identifiers only — the immutable requested branch and the branch actually checked out. */
      expectedBranch: string;
      actualBranch: string;
    }
  | {
      ok: false;
      reason: "inspection_failed";
      /** Which resolution step failed, and the failing git command's exit/spawn code — never stderr. */
      stage: "resolve_head" | "resolve_branch";
      gitErrorCode: number | string | null;
    };

export interface VerifyGitIntegrityRequest {
  /** The still-live materialised workspace path from a successful `materializeRepositoryWorkspace` call. */
  workspacePath: string;
  /** The exact `sourceRevision.headSha` already persisted for this execution run. */
  expectedHeadSha: string;
  /** The immutable requested `baseBranch` from the execution run input. */
  expectedBranch: string;
}

/** The shape `runExecutor` depends on: `runGit` is bound once at composition time (see `main.ts`), not per call. */
export type VerifyGitIntegrity = (request: VerifyGitIntegrityRequest) => Promise<GitIntegrityOutcome>;

export interface VerifyGitIntegrityParams extends VerifyGitIntegrityRequest {
  runGit: RunGit;
}

/**
 * Verifies that a coding-agent invocation left the workspace's Git history and checked-out branch
 * exactly as ADA materialised them: `HEAD` must still resolve to `expectedHeadSha`, and the
 * checked-out branch must still be `expectedBranch`. Never attempts to repair a mismatch — a
 * coding agent creating a commit, moving `HEAD`, or switching branches is reported as a safe
 * failure outcome, not silently corrected. Only ever runs the fixed `git rev-parse` subcommands
 * below; never inspects, returns, or logs stderr or repository content.
 */
export async function verifyGitIntegrity({
  workspacePath,
  expectedHeadSha,
  expectedBranch,
  runGit,
}: VerifyGitIntegrityParams): Promise<GitIntegrityOutcome> {
  const headOutcome = await runGit({ args: ["rev-parse", "HEAD"], cwd: workspacePath });
  if (!headOutcome.ok) {
    return { ok: false, reason: "inspection_failed", stage: "resolve_head", gitErrorCode: headOutcome.code };
  }
  const actualHeadSha = headOutcome.stdout.trim();
  if (actualHeadSha !== expectedHeadSha) {
    return { ok: false, reason: "head_changed", expectedHeadSha, actualHeadSha };
  }

  const branchOutcome = await runGit({ args: ["rev-parse", "--abbrev-ref", "HEAD"], cwd: workspacePath });
  if (!branchOutcome.ok) {
    return { ok: false, reason: "inspection_failed", stage: "resolve_branch", gitErrorCode: branchOutcome.code };
  }
  const actualBranch = branchOutcome.stdout.trim();
  if (actualBranch !== expectedBranch) {
    return { ok: false, reason: "branch_changed", expectedBranch, actualBranch };
  }

  return { ok: true, status: "verified" };
}
