import type {
  CiResult,
  ClaimExecutionRunOutcome,
  DeliveryIdentity,
  ExecutionRunRepository,
  MergeResultIdentity,
  RecordCiResultOutcome,
  RecordDeliveryOutcome,
  RecordMergeResultOutcome,
  RecordSourceRevisionOutcome,
} from "../executionRunRepository";

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

export interface FakeRecordDeliveryCall {
  executionRunId: string;
  delivery: DeliveryIdentity;
}

export interface FakeRecordCiResultCall {
  executionRunId: string;
  result: CiResult;
}

export interface FakeRecordMergeResultCall {
  executionRunId: string;
  result: MergeResultIdentity;
}

export function createFakeExecutionRunRepository(behavior: {
  data?: unknown;
  throwError?: Error;
  claim?: ClaimExecutionRunOutcome;
  claimThrowError?: Error;
  recordSourceRevision?: RecordSourceRevisionOutcome;
  recordSourceRevisionThrowError?: Error;
  recordDelivery?: RecordDeliveryOutcome;
  recordDeliveryThrowError?: Error;
  recordCiResult?: RecordCiResultOutcome;
  recordCiResultThrowError?: Error;
  recordMergeResult?: RecordMergeResultOutcome;
  recordMergeResultThrowError?: Error;
}): {
  repository: ExecutionRunRepository;
  calls: FakeExecutionRunRepositoryCall[];
  claimCalls: FakeClaimExecutionRunCall[];
  recordSourceRevisionCalls: FakeRecordSourceRevisionCall[];
  recordDeliveryCalls: FakeRecordDeliveryCall[];
  recordCiResultCalls: FakeRecordCiResultCall[];
  recordMergeResultCalls: FakeRecordMergeResultCall[];
} {
  const calls: FakeExecutionRunRepositoryCall[] = [];
  const claimCalls: FakeClaimExecutionRunCall[] = [];
  const recordSourceRevisionCalls: FakeRecordSourceRevisionCall[] = [];
  const recordDeliveryCalls: FakeRecordDeliveryCall[] = [];
  const recordCiResultCalls: FakeRecordCiResultCall[] = [];
  const recordMergeResultCalls: FakeRecordMergeResultCall[] = [];
  return {
    calls,
    claimCalls,
    recordSourceRevisionCalls,
    recordDeliveryCalls,
    recordCiResultCalls,
    recordMergeResultCalls,
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
      async recordDelivery(executionRunId: string, delivery: DeliveryIdentity) {
        recordDeliveryCalls.push({ executionRunId, delivery });
        if (behavior.recordDeliveryThrowError) {
          throw behavior.recordDeliveryThrowError;
        }
        return behavior.recordDelivery ?? { outcome: "created" };
      },
      async recordCiResult(executionRunId: string, result: CiResult) {
        recordCiResultCalls.push({ executionRunId, result });
        if (behavior.recordCiResultThrowError) {
          throw behavior.recordCiResultThrowError;
        }
        return behavior.recordCiResult ?? { outcome: "created" };
      },
      async recordMergeResult(executionRunId: string, result: MergeResultIdentity) {
        recordMergeResultCalls.push({ executionRunId, result });
        if (behavior.recordMergeResultThrowError) {
          throw behavior.recordMergeResultThrowError;
        }
        return behavior.recordMergeResult ?? { outcome: "created" };
      },
    },
  };
}
