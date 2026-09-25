import { createGitCommit, resolveGitCommitSha, verifyGitCommitTopology } from "./gitCommitOperations";

import type { RunGit } from "./gitProcess";

/**
 * Fixed, ADA-controlled commit identity. No parameter through which task title, prompt,
 * repository content, or coding-agent output could influence it — mirrors the same guarantee
 * `deriveDeliveryBranchName` makes for the branch name. Set via invocation-scoped `-c` flags (see
 * `createDeliveryCommit`), never written to persistent/global Git config.
 */
const ADA_DELIVERY_COMMIT_AUTHOR_NAME = "ADA Delivery Engine";
const ADA_DELIVERY_COMMIT_AUTHOR_EMAIL = "ada-delivery-engine@ada.local";

/**
 * Deterministic ADA-owned commit message for an execution request: the same `executionRequestId`
 * always derives the same message. Takes only the immutable, already-validated
 * `executionRequestId` — never task title, prompt, repository content, or coding-agent output.
 */
export function deriveDeliveryCommitMessage(executionRequestId: string): string {
  return `ADA delivery commit for execution request ${executionRequestId}`;
}

export interface StageDeliveryChangesRequest {
  /** The still-live materialised workspace path, checked out on the verified ADA delivery branch. */
  workspacePath: string;
}

export type StageDeliveryChangesOutcome =
  | { ok: true }
  | {
      ok: false;
      reason: "staging_failed";
      /** The failing git command's exit code or spawn error code — never stderr. Safe to log. */
      gitErrorCode: number | string | null;
    };

export interface StageDeliveryChangesParams extends StageDeliveryChangesRequest {
  runGit: RunGit;
}

/**
 * Stages the complete working-tree delta — tracked modifications, tracked deletions, and
 * untracked files — via a single fixed `git add -A -- .` invocation: no filenames are read from
 * repository content or derived from anything but this fixed argv. The `--` terminates option
 * parsing before the `.` pathspec, so a working-tree entry can never be misread as a git flag.
 * Only ever runs this one fixed `add` subcommand; never `commit`, `reset`, `clean`, or `stash`.
 */
export async function stageDeliveryChanges({
  workspacePath,
  runGit,
}: StageDeliveryChangesParams): Promise<StageDeliveryChangesOutcome> {
  const outcome = await runGit({ args: ["add", "-A", "--", "."], cwd: workspacePath });
  if (!outcome.ok) {
    return { ok: false, reason: "staging_failed", gitErrorCode: outcome.code };
  }
  return { ok: true };
}

export interface CreateDeliveryCommitRequest {
  /** The still-live materialised workspace path, with the intended delta already staged. */
  workspacePath: string;
  /** The ADA-controlled, deterministic commit message — see `deriveDeliveryCommitMessage`. */
  message: string;
}

export type CreateDeliveryCommitOutcome =
  | { ok: true }
  | {
      ok: false;
      reason: "commit_failed";
      /** The failing git command's exit code or spawn error code — never stderr. Safe to log. */
      gitErrorCode: number | string | null;
    };

export interface CreateDeliveryCommitParams extends CreateDeliveryCommitRequest {
  runGit: RunGit;
}

/**
 * Creates the ADA-owned commit from the already-staged index. The cloned repository is
 * attacker-influenced, so this invocation is hardened against it taking control of the operation:
 * `--no-verify` skips any repository-controlled `pre-commit`/`commit-msg`/`prepare-commit-msg`
 * hook, and `-c commit.gpgsign=false` disables signing for this invocation only. Author/committer
 * identity is likewise set via invocation-scoped `-c user.name=`/`-c user.email=` flags rather
 * than `git config` writes, so nothing persists in the workspace's `.git/config` and no ambient
 * identity (the fixture's own, or one the cloned repository's config might set) is inherited.
 */
export async function createDeliveryCommit({ workspacePath, message, runGit }: CreateDeliveryCommitParams): Promise<CreateDeliveryCommitOutcome> {
  return createGitCommit({
    workspacePath,
    message,
    authorName: ADA_DELIVERY_COMMIT_AUTHOR_NAME,
    authorEmail: ADA_DELIVERY_COMMIT_AUTHOR_EMAIL,
    runGit,
  });
}

export interface ResolveDeliveryCommitShaRequest {
  /** The still-live materialised workspace path, immediately after a successful commit. */
  workspacePath: string;
}

export type ResolveDeliveryCommitShaOutcome =
  | { ok: true; commitSha: string }
  | {
      ok: false;
      reason: "resolution_failed";
      /** The failing git command's exit code or spawn error code — never stderr. Safe to log. */
      gitErrorCode: number | string | null;
    };

export interface ResolveDeliveryCommitShaParams extends ResolveDeliveryCommitShaRequest {
  runGit: RunGit;
}

/** Resolves the just-created commit's SHA via `git rev-parse HEAD`. Never assumes success from the commit's own exit code alone. */
export async function resolveDeliveryCommitSha(params: ResolveDeliveryCommitShaParams): Promise<ResolveDeliveryCommitShaOutcome> {
  return resolveGitCommitSha(params);
}

export interface VerifyDeliveryCommitRequest {
  /** The still-live materialised workspace path. */
  workspacePath: string;
  /** The commit SHA `resolveDeliveryCommitSha` just resolved. */
  expectedCommitSha: string;
  /** The verified ADA delivery branch the commit must remain checked out on. */
  expectedBranch: string;
  /** The persisted `sourceRevision.headSha` the commit must be a direct child of. */
  expectedParentSha: string;
}

export type VerifyDeliveryCommitOutcome =
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

export interface VerifyDeliveryCommitParams extends VerifyDeliveryCommitRequest {
  runGit: RunGit;
}

/**
 * Independently re-resolves and verifies the post-commit topology — never trusts a successful
 * `git commit` exit code alone. Confirms `HEAD` still resolves to `expectedCommitSha`, the
 * checked-out branch is still `expectedBranch`, and the commit's direct parent
 * (`git rev-parse <sha>^`) is exactly `expectedParentSha` — the exact source revision ADA
 * materialised and persisted before the coding-agent invocation. Short-circuits on the first
 * failing resolution step; never attempts a later check once an earlier one could not be resolved.
 */
export async function verifyDeliveryCommit(params: VerifyDeliveryCommitParams): Promise<VerifyDeliveryCommitOutcome> {
  return verifyGitCommitTopology(params);
}

export interface EnsureAdaDeliveryCommitRequest {
  /** The still-live materialised workspace path, checked out on the verified ADA delivery branch. */
  workspacePath: string;
  /** The immutable, already-validated Execution Request identity — the only input to the commit message. */
  executionRequestId: string;
  /** The verified ADA delivery branch the commit must remain checked out on. */
  expectedBranch: string;
  /** The persisted `sourceRevision.headSha` the commit must be a direct child of. */
  expectedParentSha: string;
}

export type EnsureAdaDeliveryCommitOutcome =
  | { ok: true; commitSha: string }
  | { ok: false; reason: "staging_failed"; gitErrorCode: number | string | null }
  | { ok: false; reason: "commit_failed"; gitErrorCode: number | string | null }
  | { ok: false; reason: "resolution_failed"; gitErrorCode: number | string | null }
  | { ok: false; reason: "head_mismatch"; expectedCommitSha: string; actualHeadSha: string }
  | { ok: false; reason: "branch_mismatch"; expectedBranch: string; actualBranch: string }
  | { ok: false; reason: "parent_mismatch"; expectedParentSha: string; actualParentSha: string }
  | {
      ok: false;
      reason: "verification_inspection_failed";
      stage: "resolve_head" | "resolve_branch" | "resolve_parent";
      gitErrorCode: number | string | null;
    };

export interface EnsureAdaDeliveryCommitParams extends EnsureAdaDeliveryCommitRequest {
  runGit: RunGit;
}

/** The shape `runExecutor` depends on: `runGit` is bound once at composition time (see `main.ts`), not per call. */
export type EnsureAdaDeliveryCommit = (request: EnsureAdaDeliveryCommitRequest) => Promise<EnsureAdaDeliveryCommitOutcome>;

/**
 * Stages the coding-agent working-tree delta, creates the single ADA-owned commit, resolves its
 * SHA, and independently verifies the resulting history/branch/parent — the single composed step
 * `runExecutor` invokes once the ADA delivery branch is created and verified. Each sub-step's
 * failure short-circuits the next: nothing is committed if staging fails, and nothing is resolved
 * or verified if the commit fails.
 */
export async function ensureAdaDeliveryCommit({
  workspacePath,
  executionRequestId,
  expectedBranch,
  expectedParentSha,
  runGit,
}: EnsureAdaDeliveryCommitParams): Promise<EnsureAdaDeliveryCommitOutcome> {
  const stageOutcome = await stageDeliveryChanges({ workspacePath, runGit });
  if (!stageOutcome.ok) {
    return { ok: false, reason: "staging_failed", gitErrorCode: stageOutcome.gitErrorCode };
  }

  const message = deriveDeliveryCommitMessage(executionRequestId);
  const commitOutcome = await createDeliveryCommit({ workspacePath, message, runGit });
  if (!commitOutcome.ok) {
    return { ok: false, reason: "commit_failed", gitErrorCode: commitOutcome.gitErrorCode };
  }

  const resolveOutcome = await resolveDeliveryCommitSha({ workspacePath, runGit });
  if (!resolveOutcome.ok) {
    return { ok: false, reason: "resolution_failed", gitErrorCode: resolveOutcome.gitErrorCode };
  }

  const verifyOutcome = await verifyDeliveryCommit({
    workspacePath,
    expectedCommitSha: resolveOutcome.commitSha,
    expectedBranch,
    expectedParentSha,
    runGit,
  });
  if (!verifyOutcome.ok) {
    if (verifyOutcome.reason === "inspection_failed") {
      return {
        ok: false,
        reason: "verification_inspection_failed",
        stage: verifyOutcome.stage,
        gitErrorCode: verifyOutcome.gitErrorCode,
      };
    }
    return verifyOutcome;
  }

  return { ok: true, commitSha: resolveOutcome.commitSha };
}
