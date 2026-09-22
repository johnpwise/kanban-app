import type { RunGit } from "./gitProcess";

/**
 * Fixed, ADA-owned namespace prefix. Guarantees the derived branch name can never begin with `-`
 * regardless of `executionRequestId`'s content, so it can never be misread as a `git checkout -b`
 * option even though `checkout -b`'s own argument parsing already treats the immediately following
 * argv element as the branch name, not as another option.
 */
const ADA_DELIVERY_BRANCH_NAMESPACE = "ada/";

/**
 * Deterministic ADA-owned delivery-branch name for an execution request: the same
 * `executionRequestId` always derives the same name. Takes only the immutable, already-validated
 * `executionRequestId` — there is no parameter through which task title, prompt, repository
 * content, or coding-agent output could influence the result.
 */
export function deriveDeliveryBranchName(executionRequestId: string): string {
  return `${ADA_DELIVERY_BRANCH_NAMESPACE}${executionRequestId}`;
}

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
 * `cwd` — this is a format check, not a repository-scoped operation.
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

export interface CreateDeliveryBranchRequest {
  /** The still-live materialised workspace path from a successful `materializeRepositoryWorkspace` call. */
  workspacePath: string;
  branchName: string;
}

export type CreateDeliveryBranchOutcome =
  | { ok: true }
  | {
      ok: false;
      reason: "branch_creation_failed";
      /** The failing git command's exit code or spawn error code — never stderr. Safe to log. */
      gitErrorCode: number | string | null;
    };

export interface CreateDeliveryBranchParams extends CreateDeliveryBranchRequest {
  runGit: RunGit;
}

/**
 * Creates and checks out the ADA delivery branch from the current `HEAD` via `git checkout -b`,
 * which moves the branch ref without touching the index or working tree — the coding agent's
 * tracked modifications and untracked files are left exactly as they were. Only ever runs this one
 * fixed `checkout -b` subcommand; never `add`, `commit`, `reset`, `clean`, or `stash`.
 */
export async function createDeliveryBranch({
  workspacePath,
  branchName,
  runGit,
}: CreateDeliveryBranchParams): Promise<CreateDeliveryBranchOutcome> {
  const outcome = await runGit({ args: ["checkout", "-b", branchName], cwd: workspacePath });
  if (!outcome.ok) {
    return { ok: false, reason: "branch_creation_failed", gitErrorCode: outcome.code };
  }
  return { ok: true };
}

export interface VerifyDeliveryBranchRequest {
  /** The still-live materialised workspace path from a successful `materializeRepositoryWorkspace` call. */
  workspacePath: string;
  expectedBranch: string;
}

export type VerifyDeliveryBranchOutcome =
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

export interface VerifyDeliveryBranchParams extends VerifyDeliveryBranchRequest {
  runGit: RunGit;
}

/**
 * Confirms the workspace's checked-out branch is exactly the branch ADA just created — the same
 * `git rev-parse --abbrev-ref HEAD` check used by `verifyGitIntegrity`. Never attempts to repair a
 * mismatch; reports it as a safe failure outcome.
 */
export async function verifyDeliveryBranch({
  workspacePath,
  expectedBranch,
  runGit,
}: VerifyDeliveryBranchParams): Promise<VerifyDeliveryBranchOutcome> {
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

export interface EnsureAdaDeliveryBranchRequest {
  /** The still-live materialised workspace path from a successful `materializeRepositoryWorkspace` call. */
  workspacePath: string;
  /** The immutable, already-validated Execution Request identity — the only input to branch derivation. */
  executionRequestId: string;
}

export type EnsureAdaDeliveryBranchOutcome =
  | { ok: true; branchName: string }
  | { ok: false; reason: "invalid_branch_name"; gitErrorCode: number | string | null }
  | { ok: false; reason: "branch_creation_failed"; gitErrorCode: number | string | null }
  | { ok: false; reason: "branch_verification_failed"; expectedBranch: string; actualBranch: string }
  | { ok: false; reason: "branch_verification_inspection_failed"; gitErrorCode: number | string | null };

export interface EnsureAdaDeliveryBranchParams extends EnsureAdaDeliveryBranchRequest {
  runGit: RunGit;
}

/** The shape `runExecutor` depends on: `runGit` is bound once at composition time (see `main.ts`), not per call. */
export type EnsureAdaDeliveryBranch = (request: EnsureAdaDeliveryBranchRequest) => Promise<EnsureAdaDeliveryBranchOutcome>;

/**
 * Derives the deterministic ADA delivery-branch name, validates it as a real Git ref, creates and
 * checks it out from the still-live workspace's current `HEAD`, then verifies the checkout — the
 * single composed step `runExecutor` invokes when the working tree is `changes_detected`. Each
 * sub-step's failure short-circuits the next: an invalid name is never checked out, and a failed
 * checkout is never verified.
 */
export async function ensureAdaDeliveryBranch({
  workspacePath,
  executionRequestId,
  runGit,
}: EnsureAdaDeliveryBranchParams): Promise<EnsureAdaDeliveryBranchOutcome> {
  const branchName = deriveDeliveryBranchName(executionRequestId);

  const validateOutcome = await validateGitBranchName({ branchName, runGit });
  if (!validateOutcome.ok) {
    return { ok: false, reason: "invalid_branch_name", gitErrorCode: validateOutcome.gitErrorCode };
  }

  const createOutcome = await createDeliveryBranch({ workspacePath, branchName, runGit });
  if (!createOutcome.ok) {
    return { ok: false, reason: "branch_creation_failed", gitErrorCode: createOutcome.gitErrorCode };
  }

  const verifyOutcome = await verifyDeliveryBranch({ workspacePath, expectedBranch: branchName, runGit });
  if (!verifyOutcome.ok) {
    if (verifyOutcome.reason === "branch_mismatch") {
      return {
        ok: false,
        reason: "branch_verification_failed",
        expectedBranch: verifyOutcome.expectedBranch,
        actualBranch: verifyOutcome.actualBranch,
      };
    }
    return { ok: false, reason: "branch_verification_inspection_failed", gitErrorCode: verifyOutcome.gitErrorCode };
  }

  return { ok: true, branchName };
}
