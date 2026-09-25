import type { DeliveryCiControllerOutcome } from "./deliveryCiController";
import type { MergeCompletionRetryOutcome } from "./mergeCompletionRetryController";
import type { ExecutorOutcome } from "./runExecutor";

/**
 * Pure outcome -> process-exit-code mapping, kept separate from `main.ts` so it is unit-testable
 * without ever calling `process.exit` (which would terminate the test runner).
 */
export function exitCodeForOutcome(outcome: ExecutorOutcome): number {
  return outcome.ok ? 0 : 1;
}

/**
 * Pure outcome -> process-exit-code mapping for `ciControllerMain.ts`, kept here for the same
 * reason as `exitCodeForOutcome` above. `ci_failed` maps to 0, not 1: it means the CI-controller
 * task itself did its job correctly (durably observed and persisted a genuine terminal GitHub
 * Actions result) — the delivered code's CI failing is not a controller execution failure. Every
 * other outcome means the controller could not reach a durable terminal result at all.
 */
export function exitCodeForCiControllerOutcome(outcome: DeliveryCiControllerOutcome): number {
  return outcome.outcome === "ci_succeeded" || outcome.outcome === "ci_failed" ? 0 : 1;
}

/**
 * Pure outcome -> process-exit-code mapping for `mergeControllerMain.ts`, kept here for the same
 * reason as the other `exitCodeFor*` functions. Success (`0`) requires a durably persisted
 * trusted merge identity: either a freshly completed `merged`, or an idempotently converged
 * `merge_already_recorded` (the crash-recovery case — a prior run's GitHub merge, reconciled and
 * persisted by this run without a second GitHub mutation). Every other outcome — every
 * ineligibility reason, the bounded `mergeability_retry_exhausted`, and every persistence/
 * lifecycle-conflict/mutation-failure outcome — means the controller could not reach a durable
 * terminal result at all, and maps to `1`. Never derived from a GitHub-reported merge alone: only
 * `runMergeCompletionController`'s own persisted-outcome contract decides success here.
 */
export function exitCodeForMergeControllerOutcome(outcome: MergeCompletionRetryOutcome): number {
  return outcome.outcome === "merged" || outcome.outcome === "merge_already_recorded" ? 0 : 1;
}
