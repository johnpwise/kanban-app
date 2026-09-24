import type { DeliveryCiControllerOutcome } from "./deliveryCiController";
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
