import type { ClaimExecutionRunOutcome, ExecutionRunRepository, RecordSourceRevisionOutcome } from "../executionRunRepository";

export interface FakeExecutionRunRepositoryCall {
  executionRunId: string;
}

export interface FakeClaimExecutionRunCall {
  executionRunId: string;
  claimId: string;
}

export interface FakeRecordSourceRevisionCall {
  executionRunId: string;
  headSha: string;
}

export function createFakeExecutionRunRepository(behavior: {
  data?: unknown;
  throwError?: Error;
  claim?: ClaimExecutionRunOutcome;
  claimThrowError?: Error;
  recordSourceRevision?: RecordSourceRevisionOutcome;
  recordSourceRevisionThrowError?: Error;
}): {
  repository: ExecutionRunRepository;
  calls: FakeExecutionRunRepositoryCall[];
  claimCalls: FakeClaimExecutionRunCall[];
  recordSourceRevisionCalls: FakeRecordSourceRevisionCall[];
} {
  const calls: FakeExecutionRunRepositoryCall[] = [];
  const claimCalls: FakeClaimExecutionRunCall[] = [];
  const recordSourceRevisionCalls: FakeRecordSourceRevisionCall[] = [];
  return {
    calls,
    claimCalls,
    recordSourceRevisionCalls,
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
      async recordSourceRevision(executionRunId: string, headSha: string) {
        recordSourceRevisionCalls.push({ executionRunId, headSha });
        if (behavior.recordSourceRevisionThrowError) {
          throw behavior.recordSourceRevisionThrowError;
        }
        return behavior.recordSourceRevision ?? { outcome: "created" };
      },
    },
  };
}
