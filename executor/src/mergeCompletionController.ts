import type { ExecuteEligibleDeliveryMergeOutcome } from "./mergeExecution";
import type { ExecutionRunRepository } from "./executionRunRepository";
import type { ExecutorLogger } from "./runExecutor";

/** Excludes the two outcomes this controller intercepts to persist — every other typed
 * merge/eligibility outcome is passed through verbatim, never reinterpreted as success. */
type PassthroughOutcome = Exclude<ExecuteEligibleDeliveryMergeOutcome, { outcome: "merged" } | { outcome: "already_merged" }>;

/** A composition-bound closure over `executeEligibleDeliveryMerge` — `evaluateMergeEligibility` /
 * `mergeAdaPullRequest` are bound once by the caller (a composition root), matching how
 * `evaluateMergeEligibility` itself is bound for `mergeExecution.ts`; only `executionRunId` is
 * supplied per call. */
export type ExecuteEligibleDeliveryMergeForRun = (executionRunId: string) => Promise<ExecuteEligibleDeliveryMergeOutcome>;

export interface RunMergeCompletionControllerParams {
  executionRunId: string;
  /** The guarded merge/reconciliation boundary from PR #53, re-run fresh on every call — never a
   * cached prior result. */
  executeEligibleDeliveryMerge: ExecuteEligibleDeliveryMergeForRun;
  /** Reused unmodified — only `recordMergeResult` is called; never a read. */
  repository: ExecutionRunRepository;
  logger?: ExecutorLogger;
}

export type MergeCompletionControllerOutcome =
  | {
      outcome: "merged";
      executionRunId: string;
      repository: string;
      pullRequestNumber: number;
      deliveryCommitSha: string;
      mergeCommitSha: string;
    }
  | {
      /** The merge result was already durably recorded — a safe idempotent convergence, distinct
       * from a freshly completed `merged` so a caller never double-reports completion. */
      outcome: "merge_already_recorded";
      executionRunId: string;
      repository: string;
      pullRequestNumber: number;
      deliveryCommitSha: string;
      mergeCommitSha: string;
    }
  | { outcome: "merge_result_persistence_error"; executionRunId: string }
  | { outcome: "merge_result_conflict"; executionRunId: string }
  | { outcome: "merge_result_lifecycle_conflict"; executionRunId: string }
  | PassthroughOutcome;

/**
 * The smallest orchestration boundary above `executeEligibleDeliveryMerge`: ensures a successful or
 * safely reconciled already-merged result is durably recorded (via `repository.recordMergeResult`)
 * before the merge lifecycle stage is considered complete. This is the boundary that closes the
 * crash window PR #53 left open: if a GitHub merge succeeds but the process dies before persisting,
 * a rerun's fresh `executeEligibleDeliveryMerge` reconciles the same already-merged PR against the
 * durable delivery identity, recovers the merge commit SHA from live GitHub state, and this
 * controller durably records it — never attempting a second GitHub mutation.
 *
 * Only the two outcomes that carry a trusted merge identity (`merged`, the freshly completed
 * mutation; `already_merged`, the safely reconciled recovery) trigger a `recordMergeResult` call.
 * Every other typed outcome — every ineligible reason (including every already-merged *mismatch*
 * reason, which never becomes a recovery), and every GitHub mutation failure — passes through
 * verbatim with no persistence attempt.
 *
 * Persistence failure modes are surfaced distinctly, never folded into a false `merged` report: a
 * thrown persistence error is `merge_result_persistence_error`; a conflicting already-persisted
 * merge identity is `merge_result_conflict`; a contradictory document lifecycle state is
 * `merge_result_lifecycle_conflict`. `recordMergeResult`'s `already_recorded` outcome becomes the
 * distinct `merge_already_recorded` — a safe idempotent convergence, not a fresh completion.
 */
export async function runMergeCompletionController(
  params: RunMergeCompletionControllerParams,
): Promise<MergeCompletionControllerOutcome> {
  const { executionRunId, executeEligibleDeliveryMerge, repository, logger } = params;

  const mergeOutcome = await executeEligibleDeliveryMerge(executionRunId);

  if (mergeOutcome.outcome !== "merged" && mergeOutcome.outcome !== "already_merged") {
    return mergeOutcome;
  }

  const { repository: repositoryName, pullRequestNumber, deliveryCommitSha, mergeCommitSha } = mergeOutcome;
  const safeIdentifiers = { executionRunId, repository: repositoryName, pullRequestNumber, deliveryCommitSha, mergeCommitSha };

  let persistOutcome;
  try {
    persistOutcome = await repository.recordMergeResult(executionRunId, { deliveryCommitSha, pullRequestNumber, mergeCommitSha });
  } catch {
    logger?.error("Unexpected failure durably persisting the merge result.", safeIdentifiers);
    return { outcome: "merge_result_persistence_error", executionRunId };
  }

  if (persistOutcome.outcome === "conflict") {
    logger?.error("A conflicting merge result is already durably persisted for this execution run.", safeIdentifiers);
    return { outcome: "merge_result_conflict", executionRunId };
  }

  if (persistOutcome.outcome === "lifecycle_conflict") {
    logger?.error("Cannot persist the merge result: the execution run's lifecycle status contradicts a merge.", safeIdentifiers);
    return { outcome: "merge_result_lifecycle_conflict", executionRunId };
  }

  if (persistOutcome.outcome === "already_recorded") {
    logger?.info("Merge result already durably recorded — safe convergence.", safeIdentifiers);
    return { outcome: "merge_already_recorded", executionRunId, repository: repositoryName, pullRequestNumber, deliveryCommitSha, mergeCommitSha };
  }

  logger?.info("Merge durably recorded.", safeIdentifiers);
  return { outcome: "merged", executionRunId, repository: repositoryName, pullRequestNumber, deliveryCommitSha, mergeCommitSha };
}
