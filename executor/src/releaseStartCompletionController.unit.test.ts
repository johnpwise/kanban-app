import { describe, expect, it } from "vitest";

import { runReleaseStartCompletionController } from "./releaseStartCompletionController";
import { createFakeReleaseIntentRepository } from "./testHelpers/fakeReleaseIntentRepository";

import type { ExecuteEligibleReleaseStartForIntent } from "./releaseStartExecution";
import type { ExecuteEligibleReleaseStartOutcome } from "./releaseStartExecution";

const RELEASE_INTENT_ID = "johnpwise__kanban-app--1.4.0";
const REPOSITORY = "johnpwise/kanban-app";
const VERSION = "1.4.0";
const SOURCE_BRANCH = "develop";
const SOURCE_REVISION = "a".repeat(40);
const RELEASE_BRANCH = "release/1.4.0";
const COMMIT_SHA = "c".repeat(40);
const REMOTE_SHA = "d".repeat(40);

const STARTED_OUTCOME: ExecuteEligibleReleaseStartOutcome = {
  outcome: "started",
  releaseIntentId: RELEASE_INTENT_ID,
  repository: REPOSITORY,
  version: VERSION,
  sourceBranch: SOURCE_BRANCH,
  sourceRevision: SOURCE_REVISION,
  releaseBranch: RELEASE_BRANCH,
  commitSha: COMMIT_SHA,
  remoteSha: REMOTE_SHA,
};

const ALREADY_STARTED_OUTCOME: ExecuteEligibleReleaseStartOutcome = {
  outcome: "already_started",
  releaseIntentId: RELEASE_INTENT_ID,
  repository: REPOSITORY,
  version: VERSION,
  sourceBranch: SOURCE_BRANCH,
  sourceRevision: SOURCE_REVISION,
  releaseBranch: RELEASE_BRANCH,
  releaseCommitSha: COMMIT_SHA,
};

function fakeExecuteEligibleReleaseStart(
  outcome: ExecuteEligibleReleaseStartOutcome,
): { executeEligibleReleaseStart: ExecuteEligibleReleaseStartForIntent; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    executeEligibleReleaseStart: async (releaseIntentId) => {
      calls.push(releaseIntentId);
      return outcome;
    },
  };
}

describe("runReleaseStartCompletionController", () => {
  it("runs executeEligibleReleaseStart for the given releaseIntentId", async () => {
    // Arrange
    const { executeEligibleReleaseStart, calls } = fakeExecuteEligibleReleaseStart({
      outcome: "not_eligible",
      releaseIntentId: RELEASE_INTENT_ID,
      eligibility: { eligible: false, reason: "release_intent_not_found" },
    });
    const { repository } = createFakeReleaseIntentRepository({});

    // Act
    await runReleaseStartCompletionController({ releaseIntentId: RELEASE_INTENT_ID, executeEligibleReleaseStart, repository });

    // Assert
    expect(calls).toEqual([RELEASE_INTENT_ID]);
  });

  it("durably persists and returns a started outcome for a freshly completed release start", async () => {
    // Arrange
    const { executeEligibleReleaseStart } = fakeExecuteEligibleReleaseStart(STARTED_OUTCOME);
    const { repository, recordReleaseStartResultCalls } = createFakeReleaseIntentRepository({ recordReleaseStartResult: { outcome: "created" } });

    // Act
    const result = await runReleaseStartCompletionController({ releaseIntentId: RELEASE_INTENT_ID, executeEligibleReleaseStart, repository });

    // Assert
    expect(result).toEqual({
      outcome: "started",
      releaseIntentId: RELEASE_INTENT_ID,
      repository: REPOSITORY,
      version: VERSION,
      sourceBranch: SOURCE_BRANCH,
      sourceRevision: SOURCE_REVISION,
      releaseBranch: RELEASE_BRANCH,
      commitSha: REMOTE_SHA,
    });
    expect(recordReleaseStartResultCalls).toEqual([
      {
        releaseIntentId: RELEASE_INTENT_ID,
        identity: {
          repository: REPOSITORY,
          version: VERSION,
          sourceBranch: SOURCE_BRANCH,
          sourceRevision: SOURCE_REVISION,
          releaseBranch: RELEASE_BRANCH,
          commitSha: REMOTE_SHA,
        },
      },
    ]);
  });

  it("durably persists and returns a started outcome for a safely reconciled already-started recovery — the crash-recovery acceptance scenario", async () => {
    // Arrange: the release branch was pushed and verified, the process died before persistence, and
    // a rerun's fresh reconciliation recovered the trusted identity from live GitHub state.
    const { executeEligibleReleaseStart } = fakeExecuteEligibleReleaseStart(ALREADY_STARTED_OUTCOME);
    const { repository, recordReleaseStartResultCalls } = createFakeReleaseIntentRepository({ recordReleaseStartResult: { outcome: "created" } });

    // Act
    const result = await runReleaseStartCompletionController({ releaseIntentId: RELEASE_INTENT_ID, executeEligibleReleaseStart, repository });

    // Assert
    expect(result).toEqual({
      outcome: "started",
      releaseIntentId: RELEASE_INTENT_ID,
      repository: REPOSITORY,
      version: VERSION,
      sourceBranch: SOURCE_BRANCH,
      sourceRevision: SOURCE_REVISION,
      releaseBranch: RELEASE_BRANCH,
      commitSha: COMMIT_SHA,
    });
    expect(recordReleaseStartResultCalls).toHaveLength(1);
    expect(recordReleaseStartResultCalls[0].identity.commitSha).toBe(COMMIT_SHA);
  });

  it("returns a distinct release_start_already_recorded outcome, not re-reporting started, when persistence converges idempotently", async () => {
    // Arrange
    const { executeEligibleReleaseStart } = fakeExecuteEligibleReleaseStart(ALREADY_STARTED_OUTCOME);
    const { repository } = createFakeReleaseIntentRepository({ recordReleaseStartResult: { outcome: "already_recorded" } });

    // Act
    const result = await runReleaseStartCompletionController({ releaseIntentId: RELEASE_INTENT_ID, executeEligibleReleaseStart, repository });

    // Assert
    expect(result).toEqual({
      outcome: "release_start_already_recorded",
      releaseIntentId: RELEASE_INTENT_ID,
      repository: REPOSITORY,
      version: VERSION,
      sourceBranch: SOURCE_BRANCH,
      sourceRevision: SOURCE_REVISION,
      releaseBranch: RELEASE_BRANCH,
      commitSha: COMMIT_SHA,
    });
  });

  it("returns a distinct release_start_conflict outcome, never a false started report, when persistence finds a conflicting existing result", async () => {
    // Arrange
    const { executeEligibleReleaseStart } = fakeExecuteEligibleReleaseStart(STARTED_OUTCOME);
    const { repository } = createFakeReleaseIntentRepository({ recordReleaseStartResult: { outcome: "conflict" } });

    // Act
    const result = await runReleaseStartCompletionController({ releaseIntentId: RELEASE_INTENT_ID, executeEligibleReleaseStart, repository });

    // Assert
    expect(result).toEqual({ outcome: "release_start_conflict", releaseIntentId: RELEASE_INTENT_ID });
  });

  it("returns a distinct release_start_intent_not_found outcome when persistence finds no such release intent", async () => {
    // Arrange
    const { executeEligibleReleaseStart } = fakeExecuteEligibleReleaseStart(STARTED_OUTCOME);
    const { repository } = createFakeReleaseIntentRepository({ recordReleaseStartResult: { outcome: "release_intent_not_found" } });

    // Act
    const result = await runReleaseStartCompletionController({ releaseIntentId: RELEASE_INTENT_ID, executeEligibleReleaseStart, repository });

    // Assert
    expect(result).toEqual({ outcome: "release_start_intent_not_found", releaseIntentId: RELEASE_INTENT_ID });
  });

  it("returns a distinct release_start_intent_invalid outcome when persistence finds a malformed release intent", async () => {
    // Arrange
    const { executeEligibleReleaseStart } = fakeExecuteEligibleReleaseStart(STARTED_OUTCOME);
    const { repository } = createFakeReleaseIntentRepository({ recordReleaseStartResult: { outcome: "release_intent_invalid" } });

    // Act
    const result = await runReleaseStartCompletionController({ releaseIntentId: RELEASE_INTENT_ID, executeEligibleReleaseStart, repository });

    // Assert
    expect(result).toEqual({ outcome: "release_start_intent_invalid", releaseIntentId: RELEASE_INTENT_ID });
  });

  it("returns a distinct release_start_intent_identity_mismatch outcome when persistence finds a disagreeing immutable intent", async () => {
    // Arrange
    const { executeEligibleReleaseStart } = fakeExecuteEligibleReleaseStart(STARTED_OUTCOME);
    const { repository } = createFakeReleaseIntentRepository({ recordReleaseStartResult: { outcome: "release_intent_identity_mismatch" } });

    // Act
    const result = await runReleaseStartCompletionController({ releaseIntentId: RELEASE_INTENT_ID, executeEligibleReleaseStart, repository });

    // Assert
    expect(result).toEqual({ outcome: "release_start_intent_identity_mismatch", releaseIntentId: RELEASE_INTENT_ID });
  });

  it("returns a distinct release_start_persistence_error outcome, never a false started report, when persistence throws unexpectedly", async () => {
    // Arrange
    const { executeEligibleReleaseStart } = fakeExecuteEligibleReleaseStart(STARTED_OUTCOME);
    const { repository } = createFakeReleaseIntentRepository({ recordReleaseStartResultThrowError: new Error("firestore down") });

    // Act
    const result = await runReleaseStartCompletionController({ releaseIntentId: RELEASE_INTENT_ID, executeEligibleReleaseStart, repository });

    // Assert
    expect(result).toEqual({ outcome: "release_start_persistence_error", releaseIntentId: RELEASE_INTENT_ID });
  });

  it("attempts no persistence and passes through not_eligible verbatim", async () => {
    // Arrange
    const eligibility = { eligible: false as const, reason: "release_intent_not_found" as const };
    const { executeEligibleReleaseStart } = fakeExecuteEligibleReleaseStart({ outcome: "not_eligible", releaseIntentId: RELEASE_INTENT_ID, eligibility });
    const { repository, recordReleaseStartResultCalls } = createFakeReleaseIntentRepository({});

    // Act
    const result = await runReleaseStartCompletionController({ releaseIntentId: RELEASE_INTENT_ID, executeEligibleReleaseStart, repository });

    // Assert
    expect(result).toEqual({ outcome: "not_eligible", releaseIntentId: RELEASE_INTENT_ID, eligibility });
    expect(recordReleaseStartResultCalls).toHaveLength(0);
  });

  it("attempts no persistence and passes through workspace_materialization_failed verbatim, without retrying the mutation", async () => {
    // Arrange
    const { executeEligibleReleaseStart } = fakeExecuteEligibleReleaseStart({
      outcome: "workspace_materialization_failed",
      releaseIntentId: RELEASE_INTENT_ID,
      repository: REPOSITORY,
      reason: "clone_failed",
      gitErrorCode: 128,
    });
    const { repository, recordReleaseStartResultCalls } = createFakeReleaseIntentRepository({});

    // Act
    const result = await runReleaseStartCompletionController({ releaseIntentId: RELEASE_INTENT_ID, executeEligibleReleaseStart, repository });

    // Assert
    expect(result).toEqual({
      outcome: "workspace_materialization_failed",
      releaseIntentId: RELEASE_INTENT_ID,
      repository: REPOSITORY,
      reason: "clone_failed",
      gitErrorCode: 128,
    });
    expect(recordReleaseStartResultCalls).toHaveLength(0);
  });

  it("never leaks credential or raw response data through its result", async () => {
    // Arrange
    const { executeEligibleReleaseStart } = fakeExecuteEligibleReleaseStart(STARTED_OUTCOME);
    const { repository } = createFakeReleaseIntentRepository({ recordReleaseStartResult: { outcome: "created" } });

    // Act
    const result = await runReleaseStartCompletionController({ releaseIntentId: RELEASE_INTENT_ID, executeEligibleReleaseStart, repository });

    // Assert
    expect(JSON.stringify(result)).not.toContain("token");
  });
});
