import type {
  RecordReleaseCiResultOutcome,
  RecordReleaseIntentOutcome,
  RecordReleasePullRequestResultOutcome,
  RecordReleaseStartResultOutcome,
  ReleaseCiResultIdentity,
  ReleaseIntentIdentity,
  ReleaseIntentRepository,
  ReleasePullRequestResultIdentity,
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

export interface FakeRecordReleasePullRequestResultCall {
  releaseIntentId: string;
  identity: ReleasePullRequestResultIdentity;
}

export interface FakeRecordReleaseCiResultCall {
  releaseIntentId: string;
  identity: ReleaseCiResultIdentity;
}

export function createFakeReleaseIntentRepository(behavior: {
  data?: unknown;
  throwError?: Error;
  recordReleaseIntent?: RecordReleaseIntentOutcome;
  recordReleaseIntentThrowError?: Error;
  recordReleaseStartResult?: RecordReleaseStartResultOutcome;
  recordReleaseStartResultThrowError?: Error;
  recordReleasePullRequestResult?: RecordReleasePullRequestResultOutcome;
  recordReleasePullRequestResultThrowError?: Error;
  recordReleaseCiResult?: RecordReleaseCiResultOutcome;
  recordReleaseCiResultThrowError?: Error;
}): {
  repository: ReleaseIntentRepository;
  calls: FakeReleaseIntentRepositoryCall[];
  recordReleaseIntentCalls: FakeRecordReleaseIntentCall[];
  recordReleaseStartResultCalls: FakeRecordReleaseStartResultCall[];
  recordReleasePullRequestResultCalls: FakeRecordReleasePullRequestResultCall[];
  recordReleaseCiResultCalls: FakeRecordReleaseCiResultCall[];
} {
  const calls: FakeReleaseIntentRepositoryCall[] = [];
  const recordReleaseIntentCalls: FakeRecordReleaseIntentCall[] = [];
  const recordReleaseStartResultCalls: FakeRecordReleaseStartResultCall[] = [];
  const recordReleasePullRequestResultCalls: FakeRecordReleasePullRequestResultCall[] = [];
  const recordReleaseCiResultCalls: FakeRecordReleaseCiResultCall[] = [];
  return {
    calls,
    recordReleaseIntentCalls,
    recordReleaseStartResultCalls,
    recordReleasePullRequestResultCalls,
    recordReleaseCiResultCalls,
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
      async recordReleasePullRequestResult(releaseIntentId: string, identity: ReleasePullRequestResultIdentity) {
        recordReleasePullRequestResultCalls.push({ releaseIntentId, identity });
        if (behavior.recordReleasePullRequestResultThrowError) {
          throw behavior.recordReleasePullRequestResultThrowError;
        }
        return behavior.recordReleasePullRequestResult ?? { outcome: "created" };
      },
      async recordReleaseCiResult(releaseIntentId: string, identity: ReleaseCiResultIdentity) {
        recordReleaseCiResultCalls.push({ releaseIntentId, identity });
        if (behavior.recordReleaseCiResultThrowError) {
          throw behavior.recordReleaseCiResultThrowError;
        }
        return behavior.recordReleaseCiResult ?? { outcome: "created" };
      },
    },
  };
}
