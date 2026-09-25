import type { RunGit } from "./gitProcess";

export interface CreateGitCommitRequest {
  /** The still-live materialised workspace path, with the intended delta already staged. */
  workspacePath: string;
  message: string;
  /** Invocation-scoped author/committer identity — set via `-c user.name=`/`-c user.email=` flags,
   * never persisted to `.git/config` and never inherited from the (attacker-influenced) cloned
   * repository's own config or an ambient identity. */
  authorName: string;
  authorEmail: string;
}

export type CreateGitCommitOutcome =
  | { ok: true }
  | {
      ok: false;
      reason: "commit_failed";
      /** The failing git command's exit code or spawn error code — never stderr. Safe to log. */
      gitErrorCode: number | string | null;
    };

export interface CreateGitCommitParams extends CreateGitCommitRequest {
  runGit: RunGit;
}

/**
 * Creates a commit from the already-staged index. The cloned repository is attacker-influenced, so
 * this invocation is hardened against it taking control of the operation: `--no-verify` skips any
 * repository-controlled `pre-commit`/`commit-msg`/`prepare-commit-msg` hook, and
 * `-c commit.gpgsign=false` disables signing for this invocation only. Domain-neutral: used both
 * for the ADA delivery commit and the release-start commit, each supplying its own fixed
 * author/message.
 */
export async function createGitCommit({
  workspacePath,
  message,
  authorName,
  authorEmail,
  runGit,
}: CreateGitCommitParams): Promise<CreateGitCommitOutcome> {
  const outcome = await runGit({
    args: [
      "-c",
      `user.name=${authorName}`,
      "-c",
      `user.email=${authorEmail}`,
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--no-verify",
      "-m",
      message,
    ],
    cwd: workspacePath,
  });
  if (!outcome.ok) {
    return { ok: false, reason: "commit_failed", gitErrorCode: outcome.code };
  }
  return { ok: true };
}

export interface ResolveGitCommitShaRequest {
  /** The still-live materialised workspace path, immediately after a successful commit. */
  workspacePath: string;
}

export type ResolveGitCommitShaOutcome =
  | { ok: true; commitSha: string }
  | {
      ok: false;
      reason: "resolution_failed";
      /** The failing git command's exit code or spawn error code — never stderr. Safe to log. */
      gitErrorCode: number | string | null;
    };

export interface ResolveGitCommitShaParams extends ResolveGitCommitShaRequest {
  runGit: RunGit;
}

/** Resolves the just-created commit's SHA via `git rev-parse HEAD`. Never assumes success from the commit's own exit code alone. */
export async function resolveGitCommitSha({ workspacePath, runGit }: ResolveGitCommitShaParams): Promise<ResolveGitCommitShaOutcome> {
  const outcome = await runGit({ args: ["rev-parse", "HEAD"], cwd: workspacePath });
  if (!outcome.ok) {
    return { ok: false, reason: "resolution_failed", gitErrorCode: outcome.code };
  }
  return { ok: true, commitSha: outcome.stdout.trim() };
}

export interface VerifyGitCommitTopologyRequest {
  /** The still-live materialised workspace path. */
  workspacePath: string;
  /** The commit SHA `resolveGitCommitSha` just resolved. */
  expectedCommitSha: string;
  /** The branch the commit must remain checked out on. */
  expectedBranch: string;
  /** The exact source revision the commit must be a direct child of. */
  expectedParentSha: string;
}

export type VerifyGitCommitTopologyOutcome =
  | { ok: true }
  | {
      ok: false;
      reason: "head_mismatch";
      /** Safe git identifiers only. */
      expectedCommitSha: string;
      actualHeadSha: string;
    }
  | {
      ok: false;
      reason: "branch_mismatch";
      /** Safe git identifiers only. */
      expectedBranch: string;
      actualBranch: string;
    }
  | {
      ok: false;
      reason: "parent_mismatch";
      /** Safe git identifiers only. */
      expectedParentSha: string;
      actualParentSha: string;
    }
  | {
      ok: false;
      reason: "inspection_failed";
      /** Which resolution step failed, and the failing git command's exit/spawn code — never stderr. */
      stage: "resolve_head" | "resolve_branch" | "resolve_parent";
      gitErrorCode: number | string | null;
    };

export interface VerifyGitCommitTopologyParams extends VerifyGitCommitTopologyRequest {
  runGit: RunGit;
}

/**
 * Independently re-resolves and verifies the post-commit topology — never trusts a successful
 * `git commit` exit code alone. Confirms `HEAD` still resolves to `expectedCommitSha`, the
 * checked-out branch is still `expectedBranch`, and the commit's direct parent
 * (`git rev-parse <sha>^`) is exactly `expectedParentSha`. Short-circuits on the first failing
 * resolution step; never attempts a later check once an earlier one could not be resolved.
 * Domain-neutral: used both for the ADA delivery commit and the release-start commit.
 */
export async function verifyGitCommitTopology({
  workspacePath,
  expectedCommitSha,
  expectedBranch,
  expectedParentSha,
  runGit,
}: VerifyGitCommitTopologyParams): Promise<VerifyGitCommitTopologyOutcome> {
  const headOutcome = await runGit({ args: ["rev-parse", "HEAD"], cwd: workspacePath });
  if (!headOutcome.ok) {
    return { ok: false, reason: "inspection_failed", stage: "resolve_head", gitErrorCode: headOutcome.code };
  }
  const actualHeadSha = headOutcome.stdout.trim();
  if (actualHeadSha !== expectedCommitSha) {
    return { ok: false, reason: "head_mismatch", expectedCommitSha, actualHeadSha };
  }

  const branchOutcome = await runGit({ args: ["rev-parse", "--abbrev-ref", "HEAD"], cwd: workspacePath });
  if (!branchOutcome.ok) {
    return { ok: false, reason: "inspection_failed", stage: "resolve_branch", gitErrorCode: branchOutcome.code };
  }
  const actualBranch = branchOutcome.stdout.trim();
  if (actualBranch !== expectedBranch) {
    return { ok: false, reason: "branch_mismatch", expectedBranch, actualBranch };
  }

  const parentOutcome = await runGit({ args: ["rev-parse", `${expectedCommitSha}^`], cwd: workspacePath });
  if (!parentOutcome.ok) {
    return { ok: false, reason: "inspection_failed", stage: "resolve_parent", gitErrorCode: parentOutcome.code };
  }
  const actualParentSha = parentOutcome.stdout.trim();
  if (actualParentSha !== expectedParentSha) {
    return { ok: false, reason: "parent_mismatch", expectedParentSha, actualParentSha };
  }

  return { ok: true };
}
