import type { ClaimExecutionRunOutcome, ExecutionRunRepository } from "../executionRunRepository";

export interface FakeExecutionRunRepositoryCall {
  executionRunId: string;
}

export interface FakeClaimExecutionRunCall {
  executionRunId: string;
  claimId: string;
}

export function createFakeExecutionRunRepository(behavior: {
  data?: unknown;
  throwError?: Error;
  claim?: ClaimExecutionRunOutcome;
  claimThrowError?: Error;
}): {
  repository: ExecutionRunRepository;
  calls: FakeExecutionRunRepositoryCall[];
  claimCalls: FakeClaimExecutionRunCall[];
} {
  const calls: FakeExecutionRunRepositoryCall[] = [];
  const claimCalls: FakeClaimExecutionRunCall[] = [];
  return {
    calls,
    claimCalls,
    repository: {
      async loadExecutionRunData(executionRunId: string) {
        calls.push({ executionRunId });
        if (behavior.throwError) {
          throw behavior.throwError;
        }
        return behavior.data;
      },
      async claimExecutionRun(executionRunId: string, claimId: string) {
        claimCalls.push({ executionRunId, claimId });
        if (behavior.claimThrowError) {
          throw behavior.claimThrowError;
        }
        return behavior.claim ?? { claimed: true };
      },
    },
  };
}
