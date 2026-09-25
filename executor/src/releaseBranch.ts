import { createGitBranch, validateGitBranchName, verifyCheckedOutBranch } from "./gitBranchOperations";

import type { RunGit } from "./gitProcess";

/**
 * Deterministic release-branch name for a trusted version: the same `version` always derives the
 * same name. Takes only the exact trusted `version` from a fresh eligibility result — there is no
 * parameter through which `repository`, `sourceBranch`, or repository content could influence it.
 */
export function deriveReleaseBranchName(version: string): string {
  return `release/${version}`;
}

export interface EnsureReleaseBranchRequest {
  /** The still-live materialised workspace path, already verified to be checked out at the exact trusted `sourceRevision`. */
  workspacePath: string;
  /** The exact trusted version from a fresh eligibility result. */
  version: string;
  /** The exact trusted `sourceRevision` the new branch must still point at after creation. */
  expectedHeadSha: string;
}

export type EnsureReleaseBranchOutcome =
  | { ok: true; branchName: string }
  | { ok: false; reason: "invalid_branch_name"; gitErrorCode: number | string | null }
  | { ok: false; reason: "branch_creation_failed"; gitErrorCode: number | string | null }
  | { ok: false; reason: "branch_verification_failed"; expectedBranch: string; actualBranch: string }
  | { ok: false; reason: "branch_verification_inspection_failed"; gitErrorCode: number | string | null }
  | {
      ok: false;
      reason: "head_verification_failed";
      /** Safe git identifiers only. */
      expectedHeadSha: string;
      actualHeadSha: string;
    }
  | { ok: false; reason: "head_verification_inspection_failed"; gitErrorCode: number | string | null };

export interface EnsureReleaseBranchParams extends EnsureReleaseBranchRequest {
  runGit: RunGit;
}

/**
 * Derives the deterministic `release/<version>` branch name, validates it as a real Git ref via
 * `validateGitBranchName`, creates and checks it out from the current `HEAD` via `createGitBranch`,
 * then independently verifies both the checked-out branch name *and* that `HEAD` is still exactly
 * `expectedHeadSha` — the trusted `sourceRevision` — before any release file is touched. Each
 * sub-step's failure short-circuits the next: an invalid name is never checked out, a failed
 * checkout is never verified, and the branch itself is verified before `HEAD` is re-checked, so a
 * branch-name mismatch is never masked as a source-revision drift.
 */
export async function ensureReleaseBranch({
  workspacePath,
  version,
  expectedHeadSha,
  runGit,
}: EnsureReleaseBranchParams): Promise<EnsureReleaseBranchOutcome> {
  const branchName = deriveReleaseBranchName(version);

  const validateOutcome = await validateGitBranchName({ branchName, runGit });
  if (!validateOutcome.ok) {
    return { ok: false, reason: "invalid_branch_name", gitErrorCode: validateOutcome.gitErrorCode };
  }

  const createOutcome = await createGitBranch({ workspacePath, branchName, runGit });
  if (!createOutcome.ok) {
    return { ok: false, reason: "branch_creation_failed", gitErrorCode: createOutcome.gitErrorCode };
  }

  const branchVerifyOutcome = await verifyCheckedOutBranch({ workspacePath, expectedBranch: branchName, runGit });
  if (!branchVerifyOutcome.ok) {
    if (branchVerifyOutcome.reason === "branch_mismatch") {
      return {
        ok: false,
        reason: "branch_verification_failed",
        expectedBranch: branchVerifyOutcome.expectedBranch,
        actualBranch: branchVerifyOutcome.actualBranch,
      };
    }
    return { ok: false, reason: "branch_verification_inspection_failed", gitErrorCode: branchVerifyOutcome.gitErrorCode };
  }

  const headOutcome = await runGit({ args: ["rev-parse", "HEAD"], cwd: workspacePath });
  if (!headOutcome.ok) {
    return { ok: false, reason: "head_verification_inspection_failed", gitErrorCode: headOutcome.code };
  }
  const actualHeadSha = headOutcome.stdout.trim();
  if (actualHeadSha !== expectedHeadSha) {
    return { ok: false, reason: "head_verification_failed", expectedHeadSha, actualHeadSha };
  }

  return { ok: true, branchName };
}
