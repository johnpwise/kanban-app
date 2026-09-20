import type { ExecutorOutcome } from "./runExecutor";

/**
 * Pure outcome -> process-exit-code mapping, kept separate from `main.ts` so it is unit-testable
 * without ever calling `process.exit` (which would terminate the test runner).
 */
export function exitCodeForOutcome(outcome: ExecutorOutcome): number {
  return outcome.ok ? 0 : 1;
}
