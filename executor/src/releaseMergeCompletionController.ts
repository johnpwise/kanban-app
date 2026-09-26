import type { ExecuteEligibleReleaseMergeOutcome } from "./releaseMergeExecution";
import type { ReleaseIntentRepository, ReleaseMergeResultIdentity } from "./releaseIntentRepository";
import type { ReleasePullRequestTarget } from "./schemas/releaseIntentDocument";
import type { ExecutorLogger } from "./runExecutor";

/** Excludes the two outcomes this controller intercepts to persist — every other typed
 * eligibility/execution outcome is passed through verbatim, never reinterpreted as success. */
type PassthroughOutcome = Exclude<ExecuteEligibleReleaseMergeOutcome, { outcome: "merged" } | { outcome: "already_merged" }>;

/** A composition-bound closure over `executeEligibleReleaseMerge` — `evaluateReleaseMergeEligibility`
 * / `mergeAdaPullRequest` are bound once by the caller (a composition root), matching how
 * `EvaluateReleaseMergeEligibilityForIntent` is bound for `releaseMergeExecution.ts`; only
 * `releaseIntentId` and `target` are supplied per call. */
export type ExecuteEligibleReleaseMergeForIntent = (
  releaseIntentId: string,
  target: ReleasePullRequestTarget,
) => Promise<ExecuteEligibleReleaseMergeOutcome>;

export interface RunReleaseMergeCompletionControllerParams {
  releaseIntentId: string;
  target: ReleasePullRequestTarget;
  /** The guarded per-target merge/reconciliation boundary, re-run fresh on every call — never a
   * cached prior result. */
  executeEligibleReleaseMerge: ExecuteEligibleReleaseMergeForIntent;
  /** Reused unmodified — only `recordReleaseMergeResult` is called; never a read. */
  repository: ReleaseIntentRepository;
  logger?: ExecutorLogger;
}

export type ReleaseMergeCompletionOutcome =
  | {
      outcome: "release_merge_recorded";
      releaseIntentId: string;
      target: ReleasePullRequestTarget;
      repository: string;
      pullRequestNumber: number;
      headSha: string;
      mergeCommitSha: string;
    }
  | {
      /** The merge result was already durably recorded — a safe idempotent convergence, distinct
       * from a freshly completed `release_merge_recorded` so a caller never double-reports
       * completion. */
      outcome: "release_merge_already_recorded";
      releaseIntentId: string;
      target: ReleasePullRequestTarget;
      repository: string;
      pullRequestNumber: number;
      headSha: string;
      mergeCommitSha: string;
    }
  | { outcome: "release_merge_persistence_error"; releaseIntentId: string; target: ReleasePullRequestTarget }
  | { outcome: "release_merge_conflict"; releaseIntentId: string; target: ReleasePullRequestTarget }
  | { outcome: "release_merge_intent_not_found"; releaseIntentId: string; target: ReleasePullRequestTarget }
  | { outcome: "release_merge_intent_invalid"; releaseIntentId: string; target: ReleasePullRequestTarget }
  | { outcome: "release_merge_pull_request_missing"; releaseIntentId: string; target: ReleasePullRequestTarget }
  | { outcome: "release_merge_pull_request_identity_mismatch"; releaseIntentId: string; target: ReleasePullRequestTarget }
  | PassthroughOutcome;

/**
 * The smallest orchestration boundary above `executeEligibleReleaseMerge`, for one release-PR target
 * at a time: ensures a successful or safely reconciled already-merged result is durably recorded (via
 * `repository.recordReleaseMergeResult`) before this target's merge stage is considered complete.
 * This is the boundary that closes the crash window left open after a guarded GitHub merge succeeds
 * but the process dies before persisting: if `executeEligibleReleaseMerge` returns `merged`, or a
 * rerun's fresh eligibility reconciles the same already-merged PR against the durable release PR
 * identity and returns `already_merged`, this controller durably records the merge — never attempting
 * a second GitHub mutation, and never re-implementing `executeEligibleReleaseMerge`'s own fresh
 * eligibility re-evaluation.
 *
 * Only `merged` (a freshly completed mutation) and `already_merged` (a safely reconciled recovery)
 * trigger a `recordReleaseMergeResult` call — both are equally trusted completion inputs, and both
 * converge to the same `release_merge_recorded` / `release_merge_already_recorded` reporting. Every
 * other typed outcome — every ineligible reason (including every already-merged *mismatch* reason,
 * which never becomes a recovery), and every GitHub mutation failure — passes through verbatim with
 * no persistence attempt.
 *
 * Persistence failure modes are surfaced distinctly, never folded into a false `release_merge_recorded`
 * report: a thrown persistence error is `release_merge_persistence_error`; a conflicting
 * already-persisted merge identity is `release_merge_conflict`; the repository's fail-closed lifecycle
 * outcomes (`release_intent_not_found`, `release_intent_invalid`, `release_pull_request_missing`,
 * `release_pull_request_identity_mismatch`) are surfaced under their `release_merge_*` equivalents.
 * `recordReleaseMergeResult`'s `already_recorded` outcome becomes the distinct
 * `release_merge_already_recorded` — a safe idempotent convergence, not a fresh completion.
 *
 * This slice is deliberately single-target: sequencing `main` before `develop` and persisting both is
 * the concern of a later two-target release merge controller, not this boundary.
 */
export async function runReleaseMergeCompletionController(
  params: RunReleaseMergeCompletionControllerParams,
): Promise<ReleaseMergeCompletionOutcome> {
  const { releaseIntentId, target, executeEligibleReleaseMerge, repository, logger } = params;

  const executionOutcome = await executeEligibleReleaseMerge(releaseIntentId, target);

  if (executionOutcome.outcome !== "merged" && executionOutcome.outcome !== "already_merged") {
    return executionOutcome;
  }

  const { repository: repositoryName, pullRequestNumber, headSha, mergeCommitSha } = executionOutcome;
  const identity: ReleaseMergeResultIdentity = { target, number: pullRequestNumber, headSha, mergeCommitSha };
  const safeIdentifiers = { releaseIntentId, target, repository: repositoryName, pullRequestNumber, headSha, mergeCommitSha };

  let persistOutcome;
  try {
    persistOutcome = await repository.recordReleaseMergeResult(releaseIntentId, identity);
  } catch {
    logger?.error("Unexpected failure durably persisting the release merge result.", safeIdentifiers);
    return { outcome: "release_merge_persistence_error", releaseIntentId, target };
  }

  switch (persistOutcome.outcome) {
    case "conflict":
      logger?.error("A conflicting release merge result is already durably persisted for this target.", safeIdentifiers);
      return { outcome: "release_merge_conflict", releaseIntentId, target };
    case "release_intent_not_found":
      logger?.error("Cannot persist the release merge result: no such release intent.", safeIdentifiers);
      return { outcome: "release_merge_intent_not_found", releaseIntentId, target };
    case "release_intent_invalid":
      logger?.error("Cannot persist the release merge result: the persisted release intent document failed schema validation.", safeIdentifiers);
      return { outcome: "release_merge_intent_invalid", releaseIntentId, target };
    case "release_pull_request_missing":
      logger?.error("Cannot persist the release merge result: no durable release pull request result is persisted for this target.", safeIdentifiers);
      return { outcome: "release_merge_pull_request_missing", releaseIntentId, target };
    case "release_pull_request_identity_mismatch":
      logger?.error("Cannot persist the release merge result: the persisted pull request identity disagrees with the trusted merge result.", safeIdentifiers);
      return { outcome: "release_merge_pull_request_identity_mismatch", releaseIntentId, target };
    case "already_recorded":
      logger?.info("Release merge result already durably recorded — safe convergence.", safeIdentifiers);
      return { outcome: "release_merge_already_recorded", releaseIntentId, target, repository: repositoryName, pullRequestNumber, headSha, mergeCommitSha };
    case "created":
      logger?.info("Release merge result durably recorded.", safeIdentifiers);
      return { outcome: "release_merge_recorded", releaseIntentId, target, repository: repositoryName, pullRequestNumber, headSha, mergeCommitSha };
  }
}
