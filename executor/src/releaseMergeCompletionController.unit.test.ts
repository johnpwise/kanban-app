import { describe, expect, it } from "vitest";

import { runReleaseMergeCompletionController } from "./releaseMergeCompletionController";
import { createFakeReleaseIntentRepository } from "./testHelpers/fakeReleaseIntentRepository";

import type { ExecuteEligibleReleaseMergeForIntent } from "./releaseMergeCompletionController";
import type { ExecuteEligibleReleaseMergeOutcome } from "./releaseMergeExecution";

const RELEASE_INTENT_ID = "johnpwise__kanban-app--0.2.0";
const TARGET = "main" as const;
const REPOSITORY = "johnpwise/kanban-app";
const PULL_REQUEST_NUMBER = 101;
const HEAD_SHA = "a".repeat(40);
const MERGE_COMMIT_SHA = "c".repeat(40);

function fakeExecuteEligibleReleaseMerge(
  outcome: ExecuteEligibleReleaseMergeOutcome,
): { executeEligibleReleaseMerge: ExecuteEligibleReleaseMergeForIntent; calls: { releaseIntentId: string; target: string }[] } {
  const calls: { releaseIntentId: string; target: string }[] = [];
  return {
    calls,
    executeEligibleReleaseMerge: async (releaseIntentId, target) => {
      calls.push({ releaseIntentId, target });
      return outcome;
    },
  };
}

describe("runReleaseMergeCompletionController", () => {
  it("runs executeEligibleReleaseMerge for the given releaseIntentId and target", async () => {
    // Arrange
    const { executeEligibleReleaseMerge, calls } = fakeExecuteEligibleReleaseMerge({
      outcome: "not_eligible",
      releaseIntentId: RELEASE_INTENT_ID,
      target: TARGET,
      eligibility: { eligible: false, reason: "release_start_missing" },
    });
    const { repository } = createFakeReleaseIntentRepository({});

    // Act
    await runReleaseMergeCompletionController({ releaseIntentId: RELEASE_INTENT_ID, target: TARGET, executeEligibleReleaseMerge, repository });

    // Assert
    expect(calls).toEqual([{ releaseIntentId: RELEASE_INTENT_ID, target: TARGET }]);
  });

  it("durably persists and returns release_merge_recorded for a freshly completed merge", async () => {
    // Arrange
    const { executeEligibleReleaseMerge } = fakeExecuteEligibleReleaseMerge({
      outcome: "merged",
      releaseIntentId: RELEASE_INTENT_ID,
      target: TARGET,
      repository: REPOSITORY,
      pullRequestNumber: PULL_REQUEST_NUMBER,
      headSha: HEAD_SHA,
      mergeCommitSha: MERGE_COMMIT_SHA,
    });
    const { repository, recordReleaseMergeResultCalls } = createFakeReleaseIntentRepository({ recordReleaseMergeResult: { outcome: "created" } });

    // Act
    const result = await runReleaseMergeCompletionController({ releaseIntentId: RELEASE_INTENT_ID, target: TARGET, executeEligibleReleaseMerge, repository });

    // Assert
    expect(result).toEqual({
      outcome: "release_merge_recorded",
      releaseIntentId: RELEASE_INTENT_ID,
      target: TARGET,
      repository: REPOSITORY,
      pullRequestNumber: PULL_REQUEST_NUMBER,
      headSha: HEAD_SHA,
      mergeCommitSha: MERGE_COMMIT_SHA,
    });
    expect(recordReleaseMergeResultCalls).toEqual([
      { releaseIntentId: RELEASE_INTENT_ID, identity: { target: TARGET, number: PULL_REQUEST_NUMBER, headSha: HEAD_SHA, mergeCommitSha: MERGE_COMMIT_SHA } },
    ]);
  });

  it("durably persists and returns release_merge_recorded for a safely reconciled already-merged recovery — the crash-recovery acceptance scenario", async () => {
    // Arrange: GitHub merge succeeded, the process died before persistence, and a rerun's fresh
    // eligibility check reconciled the already-merged PR against the durable release PR identity.
    const { executeEligibleReleaseMerge } = fakeExecuteEligibleReleaseMerge({
      outcome: "already_merged",
      releaseIntentId: RELEASE_INTENT_ID,
      target: TARGET,
      repository: REPOSITORY,
      pullRequestNumber: PULL_REQUEST_NUMBER,
      headSha: HEAD_SHA,
      mergeCommitSha: MERGE_COMMIT_SHA,
    });
    const { repository, recordReleaseMergeResultCalls } = createFakeReleaseIntentRepository({ recordReleaseMergeResult: { outcome: "created" } });

    // Act
    const result = await runReleaseMergeCompletionController({ releaseIntentId: RELEASE_INTENT_ID, target: TARGET, executeEligibleReleaseMerge, repository });

    // Assert
    expect(result).toEqual({
      outcome: "release_merge_recorded",
      releaseIntentId: RELEASE_INTENT_ID,
      target: TARGET,
      repository: REPOSITORY,
      pullRequestNumber: PULL_REQUEST_NUMBER,
      headSha: HEAD_SHA,
      mergeCommitSha: MERGE_COMMIT_SHA,
    });
    expect(recordReleaseMergeResultCalls).toHaveLength(1);
  });

  it("returns a distinct release_merge_already_recorded outcome, not re-reporting a fresh recording, when persistence converges idempotently", async () => {
    // Arrange
    const { executeEligibleReleaseMerge } = fakeExecuteEligibleReleaseMerge({
      outcome: "already_merged",
      releaseIntentId: RELEASE_INTENT_ID,
      target: TARGET,
      repository: REPOSITORY,
      pullRequestNumber: PULL_REQUEST_NUMBER,
      headSha: HEAD_SHA,
      mergeCommitSha: MERGE_COMMIT_SHA,
    });
    const { repository } = createFakeReleaseIntentRepository({ recordReleaseMergeResult: { outcome: "already_recorded" } });

    // Act
    const result = await runReleaseMergeCompletionController({ releaseIntentId: RELEASE_INTENT_ID, target: TARGET, executeEligibleReleaseMerge, repository });

    // Assert
    expect(result).toEqual({
      outcome: "release_merge_already_recorded",
      releaseIntentId: RELEASE_INTENT_ID,
      target: TARGET,
      repository: REPOSITORY,
      pullRequestNumber: PULL_REQUEST_NUMBER,
      headSha: HEAD_SHA,
      mergeCommitSha: MERGE_COMMIT_SHA,
    });
  });

  it("returns a distinct release_merge_conflict outcome, never a false recorded report, when persistence finds a conflicting existing merge", async () => {
    // Arrange
    const { executeEligibleReleaseMerge } = fakeExecuteEligibleReleaseMerge({
      outcome: "merged",
      releaseIntentId: RELEASE_INTENT_ID,
      target: TARGET,
      repository: REPOSITORY,
      pullRequestNumber: PULL_REQUEST_NUMBER,
      headSha: HEAD_SHA,
      mergeCommitSha: MERGE_COMMIT_SHA,
    });
    const { repository } = createFakeReleaseIntentRepository({ recordReleaseMergeResult: { outcome: "conflict" } });

    // Act
    const result = await runReleaseMergeCompletionController({ releaseIntentId: RELEASE_INTENT_ID, target: TARGET, executeEligibleReleaseMerge, repository });

    // Assert
    expect(result).toEqual({ outcome: "release_merge_conflict", releaseIntentId: RELEASE_INTENT_ID, target: TARGET });
  });

  it.each([
    ["release_intent_not_found", "release_merge_intent_not_found"],
    ["release_intent_invalid", "release_merge_intent_invalid"],
    ["release_pull_request_missing", "release_merge_pull_request_missing"],
    ["release_pull_request_identity_mismatch", "release_merge_pull_request_identity_mismatch"],
  ] as const)("maps repository outcome %s to controller outcome %s", async (repositoryOutcome, controllerOutcome) => {
    // Arrange
    const { executeEligibleReleaseMerge } = fakeExecuteEligibleReleaseMerge({
      outcome: "merged",
      releaseIntentId: RELEASE_INTENT_ID,
      target: TARGET,
      repository: REPOSITORY,
      pullRequestNumber: PULL_REQUEST_NUMBER,
      headSha: HEAD_SHA,
      mergeCommitSha: MERGE_COMMIT_SHA,
    });
    const { repository } = createFakeReleaseIntentRepository({ recordReleaseMergeResult: { outcome: repositoryOutcome } });

    // Act
    const result = await runReleaseMergeCompletionController({ releaseIntentId: RELEASE_INTENT_ID, target: TARGET, executeEligibleReleaseMerge, repository });

    // Assert
    expect(result).toEqual({ outcome: controllerOutcome, releaseIntentId: RELEASE_INTENT_ID, target: TARGET });
  });

  it("returns a distinct release_merge_persistence_error outcome, never a false recorded report, when persistence throws unexpectedly", async () => {
    // Arrange
    const { executeEligibleReleaseMerge } = fakeExecuteEligibleReleaseMerge({
      outcome: "merged",
      releaseIntentId: RELEASE_INTENT_ID,
      target: TARGET,
      repository: REPOSITORY,
      pullRequestNumber: PULL_REQUEST_NUMBER,
      headSha: HEAD_SHA,
      mergeCommitSha: MERGE_COMMIT_SHA,
    });
    const { repository } = createFakeReleaseIntentRepository({ recordReleaseMergeResultThrowError: new Error("firestore down") });

    // Act
    const result = await runReleaseMergeCompletionController({ releaseIntentId: RELEASE_INTENT_ID, target: TARGET, executeEligibleReleaseMerge, repository });

    // Assert
    expect(result).toEqual({ outcome: "release_merge_persistence_error", releaseIntentId: RELEASE_INTENT_ID, target: TARGET });
  });

  it("attempts no persistence and passes through not_eligible verbatim, including an already-merged mismatch reason, without treating it as recovery", async () => {
    // Arrange
    const eligibility = { eligible: false as const, reason: "pull_request_already_merged_head_sha_mismatch" as const, target: TARGET, pullRequestNumber: PULL_REQUEST_NUMBER };
    const { executeEligibleReleaseMerge } = fakeExecuteEligibleReleaseMerge({ outcome: "not_eligible", releaseIntentId: RELEASE_INTENT_ID, target: TARGET, eligibility });
    const { repository, recordReleaseMergeResultCalls } = createFakeReleaseIntentRepository({});

    // Act
    const result = await runReleaseMergeCompletionController({ releaseIntentId: RELEASE_INTENT_ID, target: TARGET, executeEligibleReleaseMerge, repository });

    // Assert
    expect(result).toEqual({ outcome: "not_eligible", releaseIntentId: RELEASE_INTENT_ID, target: TARGET, eligibility });
    expect(recordReleaseMergeResultCalls).toHaveLength(0);
  });

  it("attempts no persistence and passes through pull_request_head_changed verbatim, without retrying the GitHub mutation", async () => {
    // Arrange
    const { executeEligibleReleaseMerge } = fakeExecuteEligibleReleaseMerge({
      outcome: "pull_request_head_changed",
      releaseIntentId: RELEASE_INTENT_ID,
      target: TARGET,
      repository: REPOSITORY,
      pullRequestNumber: PULL_REQUEST_NUMBER,
      expectedHeadSha: HEAD_SHA,
    });
    const { repository, recordReleaseMergeResultCalls } = createFakeReleaseIntentRepository({});

    // Act
    const result = await runReleaseMergeCompletionController({ releaseIntentId: RELEASE_INTENT_ID, target: TARGET, executeEligibleReleaseMerge, repository });

    // Assert
    expect(result).toEqual({
      outcome: "pull_request_head_changed",
      releaseIntentId: RELEASE_INTENT_ID,
      target: TARGET,
      repository: REPOSITORY,
      pullRequestNumber: PULL_REQUEST_NUMBER,
      expectedHeadSha: HEAD_SHA,
    });
    expect(recordReleaseMergeResultCalls).toHaveLength(0);
  });

  it("attempts no persistence and passes through not_mergeable verbatim", async () => {
    // Arrange
    const { executeEligibleReleaseMerge } = fakeExecuteEligibleReleaseMerge({
      outcome: "not_mergeable",
      releaseIntentId: RELEASE_INTENT_ID,
      target: TARGET,
      repository: REPOSITORY,
      pullRequestNumber: PULL_REQUEST_NUMBER,
    });
    const { repository, recordReleaseMergeResultCalls } = createFakeReleaseIntentRepository({});

    // Act
    const result = await runReleaseMergeCompletionController({ releaseIntentId: RELEASE_INTENT_ID, target: TARGET, executeEligibleReleaseMerge, repository });

    // Assert
    expect(result).toEqual({ outcome: "not_mergeable", releaseIntentId: RELEASE_INTENT_ID, target: TARGET, repository: REPOSITORY, pullRequestNumber: PULL_REQUEST_NUMBER });
    expect(recordReleaseMergeResultCalls).toHaveLength(0);
  });

  it("never leaks credential or raw response data through its result", async () => {
    // Arrange
    const { executeEligibleReleaseMerge } = fakeExecuteEligibleReleaseMerge({
      outcome: "merged",
      releaseIntentId: RELEASE_INTENT_ID,
      target: TARGET,
      repository: REPOSITORY,
      pullRequestNumber: PULL_REQUEST_NUMBER,
      headSha: HEAD_SHA,
      mergeCommitSha: MERGE_COMMIT_SHA,
    });
    const { repository } = createFakeReleaseIntentRepository({ recordReleaseMergeResult: { outcome: "created" } });

    // Act
    const result = await runReleaseMergeCompletionController({ releaseIntentId: RELEASE_INTENT_ID, target: TARGET, executeEligibleReleaseMerge, repository });

    // Assert
    expect(JSON.stringify(result)).not.toContain("token");
  });
});
