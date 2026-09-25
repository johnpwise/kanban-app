import type { RunGit } from "./gitProcess";

export interface ValidateGitBranchNameRequest {
  branchName: string;
}

export type ValidateGitBranchNameOutcome =
  | { ok: true }
  | {
      ok: false;
      reason: "invalid_ref_format";
      /** The failing git command's exit code (e.g. 1) or spawn error code — never stderr. Safe to log. */
      gitErrorCode: number | string | null;
    };

export interface ValidateGitBranchNameParams extends ValidateGitBranchNameRequest {
  runGit: RunGit;
}

/**
 * Confirms `branchName` is a valid Git ref using git's own `check-ref-format` rather than
 * reimplementing git's ref-name rules. Checked as a full `refs/heads/<branchName>` ref, with no
 * `cwd` — this is a format check, not a repository-scoped operation. Shared by every ADA-owned
 * branch-naming scheme (delivery, release, ...) — ref-format validation has no domain-specific
 * behaviour of its own.
 */
export async function validateGitBranchName({
  branchName,
  runGit,
}: ValidateGitBranchNameParams): Promise<ValidateGitBranchNameOutcome> {
  const outcome = await runGit({ args: ["check-ref-format", `refs/heads/${branchName}`] });
  if (!outcome.ok) {
    return { ok: false, reason: "invalid_ref_format", gitErrorCode: outcome.code };
  }
  return { ok: true };
}

export interface CreateGitBranchRequest {
  /** The still-live materialised workspace path from a successful `materializeRepositoryWorkspace` call. */
  workspacePath: string;
  branchName: string;
}

export type CreateGitBranchOutcome =
  | { ok: true }
  | {
      ok: false;
      reason: "branch_creation_failed";
      /** The failing git command's exit code or spawn error code — never stderr. Safe to log. */
      gitErrorCode: number | string | null;
    };

export interface CreateGitBranchParams extends CreateGitBranchRequest {
  runGit: RunGit;
}

/**
 * Creates and checks out `branchName` from the current `HEAD` via `git checkout -b`, which moves
 * the branch ref without touching the index or working tree — any already-materialised tracked
 * modifications and untracked files are left exactly as they were. Only ever runs this one fixed
 * `checkout -b` subcommand; never `add`, `commit`, `reset`, `clean`, or `stash`. Domain-neutral:
 * used both for the ADA delivery branch and the release-start branch.
 */
export async function createGitBranch({ workspacePath, branchName, runGit }: CreateGitBranchParams): Promise<CreateGitBranchOutcome> {
  const outcome = await runGit({ args: ["checkout", "-b", branchName], cwd: workspacePath });
  if (!outcome.ok) {
    return { ok: false, reason: "branch_creation_failed", gitErrorCode: outcome.code };
  }
  return { ok: true };
}

export interface VerifyCheckedOutBranchRequest {
  /** The still-live materialised workspace path from a successful `materializeRepositoryWorkspace` call. */
  workspacePath: string;
  expectedBranch: string;
}

export type VerifyCheckedOutBranchOutcome =
  | { ok: true }
  | {
      ok: false;
      reason: "branch_mismatch";
      /** Safe git identifiers only — the branch ADA created and the branch actually checked out. */
      expectedBranch: string;
      actualBranch: string;
    }
  | {
      ok: false;
      reason: "inspection_failed";
      /** The failing git command's exit code or spawn error code — never stderr. Safe to log. */
      gitErrorCode: number | string | null;
    };

export interface VerifyCheckedOutBranchParams extends VerifyCheckedOutBranchRequest {
  runGit: RunGit;
}

/**
 * Confirms the workspace's checked-out branch is exactly `expectedBranch` via
 * `git rev-parse --abbrev-ref HEAD`. Never attempts to repair a mismatch; reports it as a safe
 * failure outcome. Domain-neutral: used both for the ADA delivery branch and the release-start
 * branch.
 */
export async function verifyCheckedOutBranch({
  workspacePath,
  expectedBranch,
  runGit,
}: VerifyCheckedOutBranchParams): Promise<VerifyCheckedOutBranchOutcome> {
  const outcome = await runGit({ args: ["rev-parse", "--abbrev-ref", "HEAD"], cwd: workspacePath });
  if (!outcome.ok) {
    return { ok: false, reason: "inspection_failed", gitErrorCode: outcome.code };
  }
  const actualBranch = outcome.stdout.trim();
  if (actualBranch !== expectedBranch) {
    return { ok: false, reason: "branch_mismatch", expectedBranch, actualBranch };
  }
  return { ok: true };
}
