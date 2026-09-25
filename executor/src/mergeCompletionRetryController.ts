import type { MergeCompletionControllerOutcome } from "./mergeCompletionController";
import type { ExecutorLogger } from "./runExecutor";

/** A composition-bound closure over `runMergeCompletionController` — `executeEligibleDeliveryMerge`
 * / `repository` / `logger` are bound once by the caller (a composition root), matching how
 * `evaluateMergeEligibility` and `executeEligibleDeliveryMerge` themselves are bound elsewhere in
 * this codebase; only `executionRunId` is supplied per call. */
export type RunMergeCompletionControllerForRun = (executionRunId: string) => Promise<MergeCompletionControllerOutcome>;

export interface MergeCompletionRetryPolicy {
  /** Hard bound on the number of `runMergeCompletionController()` calls this run will make. */
  maxAttempts: number;
  /** Delay passed to the injected `wait` between two consecutive `mergeability_pending` attempts. */
  delayMs: number;
}

export interface RunMergeCompletionControllerWithRetryParams {
  executionRunId: string;
  runMergeCompletionController: RunMergeCompletionControllerForRun;
  /** Injected so tests are deterministic and perform no real sleeping. */
  wait: (delayMs: number) => Promise<void>;
  policy: MergeCompletionRetryPolicy;
  logger?: ExecutorLogger;
}

export type MergeCompletionRetryOutcome =
  | MergeCompletionControllerOutcome
  | { outcome: "mergeability_retry_exhausted"; executionRunId: string; attempts: number };

/**
 * The smallest bounded retry above `runMergeCompletionController`, narrowly scoped to the one
 * transient reason GitHub itself is still computing: `not_eligible` with
 * `eligibility.reason === "mergeability_pending"`. Every other outcome — a fresh success
 * (`merged` / `merge_already_recorded`), any other ineligibility reason, or any persistence/
 * mutation failure — is returned immediately on the first attempt that produces it; this loop
 * never retries a permanent failure, and a permanent `not_eligible` reason (e.g. `not_mergeable`,
 * a closed PR, a moved head) stays fail-closed with no further attempts.
 *
 * Each retry calls `runMergeCompletionController` fresh, which itself re-runs
 * `evaluateMergeEligibility` fresh — so a retried attempt never reuses a stale eligibility result
 * or a stale PR head; it is a brand-new, independently-verified check every time, never a standing
 * approval. Bounded by `policy.maxAttempts`; exhausting the bound while still
 * `mergeability_pending` returns the distinct `mergeability_retry_exhausted` outcome, which is
 * never treated as a successful merge completion by `exitCodeForMergeControllerOutcome`.
 */
export async function runMergeCompletionControllerWithRetry(
  params: RunMergeCompletionControllerWithRetryParams,
): Promise<MergeCompletionRetryOutcome> {
  const { executionRunId, runMergeCompletionController, wait, policy, logger } = params;

  let attempts = 0;
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
    const outcome = await runMergeCompletionController(executionRunId);
    attempts++;

    const isMergeabilityPending = outcome.outcome === "not_eligible" && outcome.eligibility.reason === "mergeability_pending";
    if (!isMergeabilityPending) {
      return outcome;
    }

    if (attempt < policy.maxAttempts) {
      logger?.info("Merge eligibility still pending GitHub's mergeability computation; retrying.", {
        executionRunId,
        attempts,
      });
      await wait(policy.delayMs);
    }
  }

  logger?.error("Exhausted the bounded mergeability-pending retry window.", { executionRunId, attempts });
  return { outcome: "mergeability_retry_exhausted", executionRunId, attempts };
}
