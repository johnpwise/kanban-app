import type {
  RecordReleaseIntentOutcome,
  RecordReleaseStartResultOutcome,
  ReleaseIntentIdentity,
  ReleaseIntentRepository,
  ReleaseStartResultIdentity,
} from "../releaseIntentRepository";

export interface FakeReleaseIntentRepositoryCall {
  releaseIntentId: string;
}

export interface FakeRecordReleaseIntentCall {
  releaseIntentId: string;
  identity: ReleaseIntentIdentity;
}

export interface FakeRecordReleaseStartResultCall {
  releaseIntentId: string;
  identity: ReleaseStartResultIdentity;
}

export function createFakeReleaseIntentRepository(behavior: {
  data?: unknown;
  throwError?: Error;
  recordReleaseIntent?: RecordReleaseIntentOutcome;
  recordReleaseIntentThrowError?: Error;
  recordReleaseStartResult?: RecordReleaseStartResultOutcome;
  recordReleaseStartResultThrowError?: Error;
}): {
  repository: ReleaseIntentRepository;
  calls: FakeReleaseIntentRepositoryCall[];
  recordReleaseIntentCalls: FakeRecordReleaseIntentCall[];
  recordReleaseStartResultCalls: FakeRecordReleaseStartResultCall[];
} {
  const calls: FakeReleaseIntentRepositoryCall[] = [];
  const recordReleaseIntentCalls: FakeRecordReleaseIntentCall[] = [];
  const recordReleaseStartResultCalls: FakeRecordReleaseStartResultCall[] = [];
  return {
    calls,
    recordReleaseIntentCalls,
    recordReleaseStartResultCalls,
    repository: {
      async loadReleaseIntentData(releaseIntentId: string) {
        calls.push({ releaseIntentId });
        if (behavior.throwError) {
          throw behavior.throwError;
        }
        return behavior.data;
      },
      async recordReleaseIntent(releaseIntentId: string, identity: ReleaseIntentIdentity) {
        recordReleaseIntentCalls.push({ releaseIntentId, identity });
        if (behavior.recordReleaseIntentThrowError) {
          throw behavior.recordReleaseIntentThrowError;
        }
        return behavior.recordReleaseIntent ?? { outcome: "created" };
      },
      async recordReleaseStartResult(releaseIntentId: string, identity: ReleaseStartResultIdentity) {
        recordReleaseStartResultCalls.push({ releaseIntentId, identity });
        if (behavior.recordReleaseStartResultThrowError) {
          throw behavior.recordReleaseStartResultThrowError;
        }
        return behavior.recordReleaseStartResult ?? { outcome: "created" };
      },
    },
  };
}
