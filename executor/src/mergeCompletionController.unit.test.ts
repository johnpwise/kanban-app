import { describe, expect, it } from "vitest";

import { runMergeCompletionController } from "./mergeCompletionController";
import { createFakeExecutionRunRepository } from "./testHelpers/fakeExecutionRunRepository";

import type { ExecuteEligibleDeliveryMergeForRun } from "./mergeCompletionController";
import type { ExecuteEligibleDeliveryMergeOutcome } from "./mergeExecution";

const EXECUTION_RUN_ID = "req-123";
const REPOSITORY = "johnpwise/kanban-app";
const PULL_REQUEST_NUMBER = 42;
const DELIVERY_COMMIT_SHA = "a".repeat(40);
const MERGE_COMMIT_SHA = "c".repeat(40);

function fakeExecuteEligibleDeliveryMerge(
  outcome: ExecuteEligibleDeliveryMergeOutcome,
): { executeEligibleDeliveryMerge: ExecuteEligibleDeliveryMergeForRun; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    executeEligibleDeliveryMerge: async (executionRunId) => {
      calls.push(executionRunId);
      return outcome;
    },
  };
}

describe("runMergeCompletionController", () => {
  it("should run executeEligibleDeliveryMerge for the given executionRunId", async () => {
    // Arrange
    const { executeEligibleDeliveryMerge, calls } = fakeExecuteEligibleDeliveryMerge({ outcome: "not_eligible", executionRunId: EXECUTION_RUN_ID, eligibility: { eligible: false, reason: "status_not_ci_succeeded", status: "accepted" } });
    const { repository } = createFakeExecutionRunRepository({});

    // Act
    await runMergeCompletionController({ executionRunId: EXECUTION_RUN_ID, executeEligibleDeliveryMerge, repository });

    // Assert
    expect(calls).toEqual([EXECUTION_RUN_ID]);
  });

  it("should durably persist and return a merged outcome for a newly completed merge", async () => {
    // Arrange
    const { executeEligibleDeliveryMerge } = fakeExecuteEligibleDeliveryMerge({
      outcome: "merged",
      executionRunId: EXECUTION_RUN_ID,
      repository: REPOSITORY,
      pullRequestNumber: PULL_REQUEST_NUMBER,
      deliveryCommitSha: DELIVERY_COMMIT_SHA,
      mergeCommitSha: MERGE_COMMIT_SHA,
    });
    const { repository, recordMergeResultCalls } = createFakeExecutionRunRepository({ recordMergeResult: { outcome: "created" } });

    // Act
    const result = await runMergeCompletionController({ executionRunId: EXECUTION_RUN_ID, executeEligibleDeliveryMerge, repository });

    // Assert
    expect(result).toEqual({
      outcome: "merged",
      executionRunId: EXECUTION_RUN_ID,
      repository: REPOSITORY,
      pullRequestNumber: PULL_REQUEST_NUMBER,
      deliveryCommitSha: DELIVERY_COMMIT_SHA,
      mergeCommitSha: MERGE_COMMIT_SHA,
    });
    expect(recordMergeResultCalls).toEqual([
      { executionRunId: EXECUTION_RUN_ID, result: { deliveryCommitSha: DELIVERY_COMMIT_SHA, pullRequestNumber: PULL_REQUEST_NUMBER, mergeCommitSha: MERGE_COMMIT_SHA } },
    ]);
  });

  it("should durably persist and return a merged outcome for a safely reconciled already-merged recovery — the crash-recovery acceptance scenario", async () => {
    // Arrange: GitHub merge succeeded, the process died before persistence, and a rerun's fresh
    // eligibility check reconciled the already-merged PR against the durable delivery identity.
    const { executeEligibleDeliveryMerge } = fakeExecuteEligibleDeliveryMerge({
      outcome: "already_merged",
      executionRunId: EXECUTION_RUN_ID,
      repository: REPOSITORY,
      pullRequestNumber: PULL_REQUEST_NUMBER,
      deliveryCommitSha: DELIVERY_COMMIT_SHA,
      mergeCommitSha: MERGE_COMMIT_SHA,
    });
    const { repository, recordMergeResultCalls } = createFakeExecutionRunRepository({ recordMergeResult: { outcome: "created" } });

    // Act
    const result = await runMergeCompletionController({ executionRunId: EXECUTION_RUN_ID, executeEligibleDeliveryMerge, repository });

    // Assert
    expect(result).toEqual({
      outcome: "merged",
      executionRunId: EXECUTION_RUN_ID,
      repository: REPOSITORY,
      pullRequestNumber: PULL_REQUEST_NUMBER,
      deliveryCommitSha: DELIVERY_COMMIT_SHA,
      mergeCommitSha: MERGE_COMMIT_SHA,
    });
    expect(recordMergeResultCalls).toHaveLength(1);
  });

  it("should return a distinct merge_already_recorded outcome, not re-reporting merged, when persistence converges idempotently", async () => {
    // Arrange
    const { executeEligibleDeliveryMerge } = fakeExecuteEligibleDeliveryMerge({
      outcome: "already_merged",
      executionRunId: EXECUTION_RUN_ID,
      repository: REPOSITORY,
      pullRequestNumber: PULL_REQUEST_NUMBER,
      deliveryCommitSha: DELIVERY_COMMIT_SHA,
      mergeCommitSha: MERGE_COMMIT_SHA,
    });
    const { repository } = createFakeExecutionRunRepository({ recordMergeResult: { outcome: "already_recorded" } });

    // Act
    const result = await runMergeCompletionController({ executionRunId: EXECUTION_RUN_ID, executeEligibleDeliveryMerge, repository });

    // Assert
    expect(result).toEqual({
      outcome: "merge_already_recorded",
      executionRunId: EXECUTION_RUN_ID,
      repository: REPOSITORY,
      pullRequestNumber: PULL_REQUEST_NUMBER,
      deliveryCommitSha: DELIVERY_COMMIT_SHA,
      mergeCommitSha: MERGE_COMMIT_SHA,
    });
  });

  it("should return a distinct merge_result_conflict outcome, never a false merged report, when persistence finds a conflicting existing merge", async () => {
    // Arrange
    const { executeEligibleDeliveryMerge } = fakeExecuteEligibleDeliveryMerge({
      outcome: "merged",
      executionRunId: EXECUTION_RUN_ID,
      repository: REPOSITORY,
      pullRequestNumber: PULL_REQUEST_NUMBER,
      deliveryCommitSha: DELIVERY_COMMIT_SHA,
      mergeCommitSha: MERGE_COMMIT_SHA,
    });
    const { repository } = createFakeExecutionRunRepository({ recordMergeResult: { outcome: "conflict" } });

    // Act
    const result = await runMergeCompletionController({ executionRunId: EXECUTION_RUN_ID, executeEligibleDeliveryMerge, repository });

    // Assert
    expect(result).toEqual({ outcome: "merge_result_conflict", executionRunId: EXECUTION_RUN_ID });
  });

  it("should return a distinct merge_result_lifecycle_conflict outcome when persistence finds a contradictory lifecycle state", async () => {
    // Arrange
    const { executeEligibleDeliveryMerge } = fakeExecuteEligibleDeliveryMerge({
      outcome: "merged",
      executionRunId: EXECUTION_RUN_ID,
      repository: REPOSITORY,
      pullRequestNumber: PULL_REQUEST_NUMBER,
      deliveryCommitSha: DELIVERY_COMMIT_SHA,
      mergeCommitSha: MERGE_COMMIT_SHA,
    });
    const { repository } = createFakeExecutionRunRepository({ recordMergeResult: { outcome: "lifecycle_conflict" } });

    // Act
    const result = await runMergeCompletionController({ executionRunId: EXECUTION_RUN_ID, executeEligibleDeliveryMerge, repository });

    // Assert
    expect(result).toEqual({ outcome: "merge_result_lifecycle_conflict", executionRunId: EXECUTION_RUN_ID });
  });

  it("should return a distinct merge_result_persistence_error outcome, never a false merged report, when persistence throws unexpectedly", async () => {
    // Arrange
    const { executeEligibleDeliveryMerge } = fakeExecuteEligibleDeliveryMerge({
      outcome: "merged",
      executionRunId: EXECUTION_RUN_ID,
      repository: REPOSITORY,
      pullRequestNumber: PULL_REQUEST_NUMBER,
      deliveryCommitSha: DELIVERY_COMMIT_SHA,
      mergeCommitSha: MERGE_COMMIT_SHA,
    });
    const { repository } = createFakeExecutionRunRepository({ recordMergeResultThrowError: new Error("firestore down") });

    // Act
    const result = await runMergeCompletionController({ executionRunId: EXECUTION_RUN_ID, executeEligibleDeliveryMerge, repository });

    // Assert
    expect(result).toEqual({ outcome: "merge_result_persistence_error", executionRunId: EXECUTION_RUN_ID });
  });

  it("should attempt no persistence and pass through not_eligible verbatim, including an already-merged mismatch reason, without treating it as recovery", async () => {
    // Arrange
    const eligibility = { eligible: false as const, reason: "pull_request_already_merged_head_sha_mismatch" as const };
    const { executeEligibleDeliveryMerge } = fakeExecuteEligibleDeliveryMerge({ outcome: "not_eligible", executionRunId: EXECUTION_RUN_ID, eligibility });
    const { repository, recordMergeResultCalls } = createFakeExecutionRunRepository({});

    // Act
    const result = await runMergeCompletionController({ executionRunId: EXECUTION_RUN_ID, executeEligibleDeliveryMerge, repository });

    // Assert
    expect(result).toEqual({ outcome: "not_eligible", executionRunId: EXECUTION_RUN_ID, eligibility });
    expect(recordMergeResultCalls).toHaveLength(0);
  });

  it("should attempt no persistence and pass through pull_request_head_changed verbatim, without retrying the GitHub mutation", async () => {
    // Arrange
    const { executeEligibleDeliveryMerge } = fakeExecuteEligibleDeliveryMerge({
      outcome: "pull_request_head_changed",
      executionRunId: EXECUTION_RUN_ID,
      repository: REPOSITORY,
      pullRequestNumber: PULL_REQUEST_NUMBER,
      expectedCommitSha: DELIVERY_COMMIT_SHA,
    });
    const { repository, recordMergeResultCalls } = createFakeExecutionRunRepository({});

    // Act
    const result = await runMergeCompletionController({ executionRunId: EXECUTION_RUN_ID, executeEligibleDeliveryMerge, repository });

    // Assert
    expect(result).toEqual({
      outcome: "pull_request_head_changed",
      executionRunId: EXECUTION_RUN_ID,
      repository: REPOSITORY,
      pullRequestNumber: PULL_REQUEST_NUMBER,
      expectedCommitSha: DELIVERY_COMMIT_SHA,
    });
    expect(recordMergeResultCalls).toHaveLength(0);
  });

  it("should never leak credential or raw response data through its result", async () => {
    // Arrange
    const { executeEligibleDeliveryMerge } = fakeExecuteEligibleDeliveryMerge({
      outcome: "merged",
      executionRunId: EXECUTION_RUN_ID,
      repository: REPOSITORY,
      pullRequestNumber: PULL_REQUEST_NUMBER,
      deliveryCommitSha: DELIVERY_COMMIT_SHA,
      mergeCommitSha: MERGE_COMMIT_SHA,
    });
    const { repository } = createFakeExecutionRunRepository({ recordMergeResult: { outcome: "created" } });

    // Act
    const result = await runMergeCompletionController({ executionRunId: EXECUTION_RUN_ID, executeEligibleDeliveryMerge, repository });

    // Assert
    expect(JSON.stringify(result)).not.toContain("token");
  });
});
