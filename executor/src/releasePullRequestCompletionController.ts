import type { ExecuteEligibleReleasePullRequestOutcome } from "./releasePullRequestExecution";
import type { ReleaseIntentRepository, ReleasePullRequestResultIdentity } from "./releaseIntentRepository";
import type { ReleasePullRequestTarget } from "./schemas/releaseIntentDocument";
import type { ExecutorLogger } from "./runExecutor";

/** Excludes the one outcome this controller intercepts to persist — every other typed
 * eligibility/execution/verification outcome is passed through verbatim, never reinterpreted as
 * success. */
type PassthroughOutcome = Exclude<ExecuteEligibleReleasePullRequestOutcome, { outcome: "verified" }>;

/** A composition-bound closure over `executeEligibleReleasePullRequest` — every other param is
 * bound once by the caller (a composition root); `releaseIntentId`/`target` are supplied per
 * call, mirroring `EvaluateReleasePullRequestEligibilityForIntent` generalized to two targets. */
export type ExecuteEligibleReleasePullRequestForIntent = (
  releaseIntentId: string,
  target: ReleasePullRequestTarget,
) => Promise<ExecuteEligibleReleasePullRequestOutcome>;

export interface RunReleasePullRequestCompletionControllerParams {
  releaseIntentId: string;
  /** The guarded per-target create/reuse + fresh-verification boundary, re-run fresh for each
   * target on every call — never a cached prior result. */
  executeEligibleReleasePullRequest: ExecuteEligibleReleasePullRequestForIntent;
  /** Reused unmodified — only `recordReleasePullRequestResult` is called; never a read. */
  repository: ReleaseIntentRepository;
  logger?: ExecutorLogger;
}

export type ReleasePullRequestTargetCompletionOutcome =
  | {
      outcome: "release_pull_request_recorded";
      releaseIntentId: string;
      target: ReleasePullRequestTarget;
      repository: string;
      version: string;
      releaseBranch: string;
      releaseCommitSha: string;
      number: number;
    }
  | {
      /** The release-PR result was already durably recorded — a safe idempotent convergence,
       * distinct from a freshly completed `release_pull_request_recorded` so a caller never
       * double-reports completion. */
      outcome: "release_pull_request_already_recorded";
      releaseIntentId: string;
      target: ReleasePullRequestTarget;
      repository: string;
      version: string;
      releaseBranch: string;
      releaseCommitSha: string;
      number: number;
    }
  | { outcome: "release_pull_request_persistence_error"; releaseIntentId: string; target: ReleasePullRequestTarget }
  | { outcome: "release_pull_request_conflict"; releaseIntentId: string; target: ReleasePullRequestTarget }
  | { outcome: "release_pull_request_intent_not_found"; releaseIntentId: string; target: ReleasePullRequestTarget }
  | { outcome: "release_pull_request_intent_invalid"; releaseIntentId: string; target: ReleasePullRequestTarget }
  | { outcome: "release_pull_request_intent_identity_mismatch"; releaseIntentId: string; target: ReleasePullRequestTarget }
  | { outcome: "release_pull_request_start_missing"; releaseIntentId: string; target: ReleasePullRequestTarget }
  | { outcome: "release_pull_request_start_identity_mismatch"; releaseIntentId: string; target: ReleasePullRequestTarget }
  | PassthroughOutcome;

export interface ReleasePullRequestCompletionControllerOutcome {
  releaseIntentId: string;
  main: ReleasePullRequestTargetCompletionOutcome;
  develop: ReleasePullRequestTargetCompletionOutcome;
}

async function completeTarget(
  releaseIntentId: string,
  target: ReleasePullRequestTarget,
  executeEligibleReleasePullRequest: ExecuteEligibleReleasePullRequestForIntent,
  repository: ReleaseIntentRepository,
  logger?: ExecutorLogger,
): Promise<ReleasePullRequestTargetCompletionOutcome> {
  const executionOutcome = await executeEligibleReleasePullRequest(releaseIntentId, target);

  if (executionOutcome.outcome !== "verified") {
    return executionOutcome;
  }

  const { repository: repositoryName, version, sourceBranch, sourceRevision, releaseBranch, releaseCommitSha, number } = executionOutcome;
  const identity: ReleasePullRequestResultIdentity = {
    repository: repositoryName,
    version,
    sourceBranch,
    sourceRevision,
    releaseBranch,
    commitSha: releaseCommitSha,
    target,
    number,
  };
  const safeIdentifiers = { releaseIntentId, target, repository: repositoryName, version, releaseBranch, releaseCommitSha, number };

  let persistOutcome;
  try {
    persistOutcome = await repository.recordReleasePullRequestResult(releaseIntentId, identity);
  } catch {
    logger?.error("Unexpected failure durably persisting the release pull request result.", safeIdentifiers);
    return { outcome: "release_pull_request_persistence_error", releaseIntentId, target };
  }

  switch (persistOutcome.outcome) {
    case "conflict":
      logger?.error("A conflicting release pull request result is already durably persisted for this target.", safeIdentifiers);
      return { outcome: "release_pull_request_conflict", releaseIntentId, target };
    case "release_intent_not_found":
      logger?.error("Cannot persist the release pull request result: no such release intent.", safeIdentifiers);
      return { outcome: "release_pull_request_intent_not_found", releaseIntentId, target };
    case "release_intent_invalid":
      logger?.error("Cannot persist the release pull request result: the persisted release intent document failed schema validation.", safeIdentifiers);
      return { outcome: "release_pull_request_intent_invalid", releaseIntentId, target };
    case "release_intent_identity_mismatch":
      logger?.error("Cannot persist the release pull request result: the trusted identity disagrees with the persisted immutable release intent.", safeIdentifiers);
      return { outcome: "release_pull_request_intent_identity_mismatch", releaseIntentId, target };
    case "release_start_missing":
      logger?.error("Cannot persist the release pull request result: the release intent has no durable start result.", safeIdentifiers);
      return { outcome: "release_pull_request_start_missing", releaseIntentId, target };
    case "release_start_identity_mismatch":
      logger?.error("Cannot persist the release pull request result: the trusted identity disagrees with the persisted start result.", safeIdentifiers);
      return { outcome: "release_pull_request_start_identity_mismatch", releaseIntentId, target };
    case "already_recorded":
      logger?.info("Release pull request result already durably recorded — safe convergence.", safeIdentifiers);
      return { outcome: "release_pull_request_already_recorded", releaseIntentId, target, repository: repositoryName, version, releaseBranch, releaseCommitSha, number };
    case "created":
      logger?.info("Release pull request result durably recorded.", safeIdentifiers);
      return { outcome: "release_pull_request_recorded", releaseIntentId, target, repository: repositoryName, version, releaseBranch, releaseCommitSha, number };
  }
}

/**
 * The smallest orchestration boundary above `executeEligibleReleasePullRequest`: ensures each of
 * the two trusted targets' (`main`, `develop`) freshly completed or safely reconciled release-PR
 * result is durably recorded (via `repository.recordReleasePullRequestResult`) before the
 * release-PR stage is considered complete for that target. Targets are fully independent — each is
 * executed and persisted separately via `completeTarget`, so this controller closes the crash
 * window left open after a guarded create/reuse+verify succeeds but the process dies before
 * persistence, for *either* target *independently*:
 *
 * - If `main` was already durably recorded on a prior attempt but `develop` was not (the process
 *   died between the two), re-running this controller re-executes both fresh: `main`'s create/reuse
 *   call safely *reuses* the already-existing PR (its own lookup-first idempotency, never a
 *   duplicate create) and its persistence converges to `already_recorded`; `develop`'s create/reuse
 *   call actually creates the still-missing PR and its persistence records it for the first time.
 * - If both PRs were created but the process died before persisting either, re-running this
 *   controller reuses (never re-creates) both via the same lookup-first idempotency, then persists
 *   both for the first time — no second GitHub mutation for either target.
 *
 * Every non-`verified` execution outcome (ineligible, create/reuse failure, any verification
 * mismatch) passes through verbatim under that target's field with no persistence attempt — a
 * manually-created, retargeted, or otherwise contradictory PR that fails fresh verification is
 * never adopted as trusted evidence, and a persistence failure for one target never deletes or
 * retries a mutation for the other.
 */
export async function runReleasePullRequestCompletionController(
  params: RunReleasePullRequestCompletionControllerParams,
): Promise<ReleasePullRequestCompletionControllerOutcome> {
  const { releaseIntentId, executeEligibleReleasePullRequest, repository, logger } = params;

  const main = await completeTarget(releaseIntentId, "main", executeEligibleReleasePullRequest, repository, logger);
  const develop = await completeTarget(releaseIntentId, "develop", executeEligibleReleasePullRequest, repository, logger);

  return { releaseIntentId, main, develop };
}
