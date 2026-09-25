import { describe, expect, it } from "vitest";

import { executeEligibleDeliveryMerge } from "./mergeExecution";

import type { MergeAdaPullRequest, MergeAdaPullRequestRequest } from "./adaPullRequestMerge";
import type { EvaluateMergeEligibilityForRun } from "./mergeExecution";
import type { MergeEligibilityOutcome } from "./mergeEligibility";

const EXECUTION_RUN_ID = "req-123";
const REPOSITORY = "johnpwise/kanban-app";
const PULL_REQUEST_NUMBER = 42;
const DELIVERY_COMMIT_SHA = "a".repeat(40);
const MERGE_COMMIT_SHA = "c".repeat(40);

const ELIGIBLE_RESULT: MergeEligibilityOutcome = {
  eligible: true,
  executionRunId: EXECUTION_RUN_ID,
  repository: REPOSITORY,
  commitSha: DELIVERY_COMMIT_SHA,
  pullRequestNumber: PULL_REQUEST_NUMBER,
};

function fakeEvaluateMergeEligibility(outcome: MergeEligibilityOutcome): {
  evaluateMergeEligibility: EvaluateMergeEligibilityForRun;
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    evaluateMergeEligibility: async (executionRunId) => {
      calls.push(executionRunId);
      return outcome;
    },
  };
}

function fakeMergeAdaPullRequest(
  outcome: Awaited<ReturnType<MergeAdaPullRequest>>,
): { mergeAdaPullRequest: MergeAdaPullRequest; calls: MergeAdaPullRequestRequest[] } {
  const calls: MergeAdaPullRequestRequest[] = [];
  return {
    calls,
    mergeAdaPullRequest: (async (request) => {
      calls.push(request);
      return outcome;
    }) as MergeAdaPullRequest,
  };
}

describe("executeEligibleDeliveryMerge", () => {
  it("should attempt no GitHub mutation and return typed not_eligible, preserving the exact eligibility reason, when not eligible", async () => {
    // Arrange
    const notEligible: MergeEligibilityOutcome = { eligible: false, reason: "pull_request_head_sha_mismatch" };
    const { evaluateMergeEligibility } = fakeEvaluateMergeEligibility(notEligible);
    const { mergeAdaPullRequest, calls } = fakeMergeAdaPullRequest({ ok: true, mergeCommitSha: MERGE_COMMIT_SHA });

    // Act
    const result = await executeEligibleDeliveryMerge({ executionRunId: EXECUTION_RUN_ID, evaluateMergeEligibility, mergeAdaPullRequest });

    // Assert
    expect(result).toEqual({ outcome: "not_eligible", executionRunId: EXECUTION_RUN_ID, eligibility: notEligible });
    expect(calls).toHaveLength(0);
  });

  it("should run evaluateMergeEligibility freshly for the given executionRunId, never a cached/prior result", async () => {
    // Arrange
    const { evaluateMergeEligibility, calls } = fakeEvaluateMergeEligibility(ELIGIBLE_RESULT);
    const { mergeAdaPullRequest } = fakeMergeAdaPullRequest({ ok: true, mergeCommitSha: MERGE_COMMIT_SHA });

    // Act
    await executeEligibleDeliveryMerge({ executionRunId: EXECUTION_RUN_ID, evaluateMergeEligibility, mergeAdaPullRequest });

    // Assert
    expect(calls).toEqual([EXECUTION_RUN_ID]);
  });

  it("should return a distinct already_merged outcome carrying the reconciled trusted identity — not a generic not_eligible/failure, and no second GitHub mutation — for the already-merged repeat-invocation path", async () => {
    // Arrange
    const alreadyMerged: MergeEligibilityOutcome = {
      eligible: false,
      reason: "pull_request_already_merged",
      executionRunId: EXECUTION_RUN_ID,
      repository: REPOSITORY,
      pullRequestNumber: PULL_REQUEST_NUMBER,
      deliveryCommitSha: DELIVERY_COMMIT_SHA,
      mergeCommitSha: MERGE_COMMIT_SHA,
    };
    const { evaluateMergeEligibility } = fakeEvaluateMergeEligibility(alreadyMerged);
    const { mergeAdaPullRequest, calls } = fakeMergeAdaPullRequest({ ok: true, mergeCommitSha: MERGE_COMMIT_SHA });

    // Act
    const result = await executeEligibleDeliveryMerge({ executionRunId: EXECUTION_RUN_ID, evaluateMergeEligibility, mergeAdaPullRequest });

    // Assert
    expect(result).toEqual({
      outcome: "already_merged",
      executionRunId: EXECUTION_RUN_ID,
      repository: REPOSITORY,
      pullRequestNumber: PULL_REQUEST_NUMBER,
      deliveryCommitSha: DELIVERY_COMMIT_SHA,
      mergeCommitSha: MERGE_COMMIT_SHA,
    });
    expect(calls).toHaveLength(0);
  });

  it("should pass through an already-merged mismatch reason as an ordinary not_eligible failure, never a successful recovery", async () => {
    // Arrange
    const mismatched: MergeEligibilityOutcome = { eligible: false, reason: "pull_request_already_merged_head_sha_mismatch" };
    const { evaluateMergeEligibility } = fakeEvaluateMergeEligibility(mismatched);
    const { mergeAdaPullRequest, calls } = fakeMergeAdaPullRequest({ ok: true, mergeCommitSha: MERGE_COMMIT_SHA });

    // Act
    const result = await executeEligibleDeliveryMerge({ executionRunId: EXECUTION_RUN_ID, evaluateMergeEligibility, mergeAdaPullRequest });

    // Assert
    expect(result).toEqual({ outcome: "not_eligible", executionRunId: EXECUTION_RUN_ID, eligibility: mismatched });
    expect(calls).toHaveLength(0);
  });

  it("should call the merge primitive using only the repository/PR number/SHA from the trusted eligible result, never caller-supplied values", async () => {
    // Arrange
    const { evaluateMergeEligibility } = fakeEvaluateMergeEligibility(ELIGIBLE_RESULT);
    const { mergeAdaPullRequest, calls } = fakeMergeAdaPullRequest({ ok: true, mergeCommitSha: MERGE_COMMIT_SHA });

    // Act
    await executeEligibleDeliveryMerge({ executionRunId: EXECUTION_RUN_ID, evaluateMergeEligibility, mergeAdaPullRequest });

    // Assert
    expect(calls).toEqual([
      { repository: REPOSITORY, pullRequestNumber: PULL_REQUEST_NUMBER, expectedHeadSha: DELIVERY_COMMIT_SHA },
    ]);
  });

  it("should return typed merged with safe identifiers, keeping deliveryCommitSha and mergeCommitSha distinct, on a successful merge", async () => {
    // Arrange
    const { evaluateMergeEligibility } = fakeEvaluateMergeEligibility(ELIGIBLE_RESULT);
    const { mergeAdaPullRequest } = fakeMergeAdaPullRequest({ ok: true, mergeCommitSha: MERGE_COMMIT_SHA });

    // Act
    const result = await executeEligibleDeliveryMerge({ executionRunId: EXECUTION_RUN_ID, evaluateMergeEligibility, mergeAdaPullRequest });

    // Assert
    expect(result).toEqual({
      outcome: "merged",
      executionRunId: EXECUTION_RUN_ID,
      repository: REPOSITORY,
      pullRequestNumber: PULL_REQUEST_NUMBER,
      deliveryCommitSha: DELIVERY_COMMIT_SHA,
      mergeCommitSha: MERGE_COMMIT_SHA,
    });
  });

  it("should fail closed with a distinct pull_request_head_changed outcome, and not retry, when the PR head moved between eligibility and the merge attempt", async () => {
    // Arrange
    const { evaluateMergeEligibility, calls: eligibilityCalls } = fakeEvaluateMergeEligibility(ELIGIBLE_RESULT);
    const { mergeAdaPullRequest, calls } = fakeMergeAdaPullRequest({ ok: false, reason: "pull_request_head_changed" });

    // Act
    const result = await executeEligibleDeliveryMerge({ executionRunId: EXECUTION_RUN_ID, evaluateMergeEligibility, mergeAdaPullRequest });

    // Assert
    expect(result).toEqual({
      outcome: "pull_request_head_changed",
      executionRunId: EXECUTION_RUN_ID,
      repository: REPOSITORY,
      pullRequestNumber: PULL_REQUEST_NUMBER,
      expectedCommitSha: DELIVERY_COMMIT_SHA,
    });
    expect(calls).toHaveLength(1);
    expect(eligibilityCalls).toHaveLength(1);
  });

  it("should pass through not_mergeable from the merge primitive", async () => {
    // Arrange
    const { evaluateMergeEligibility } = fakeEvaluateMergeEligibility(ELIGIBLE_RESULT);
    const { mergeAdaPullRequest } = fakeMergeAdaPullRequest({ ok: false, reason: "not_mergeable" });

    // Act
    const result = await executeEligibleDeliveryMerge({ executionRunId: EXECUTION_RUN_ID, evaluateMergeEligibility, mergeAdaPullRequest });

    // Assert
    expect(result).toEqual({ outcome: "not_mergeable", executionRunId: EXECUTION_RUN_ID, repository: REPOSITORY, pullRequestNumber: PULL_REQUEST_NUMBER });
  });

  it("should pass through merge_permission_denied from the merge primitive without leaking credential/response data", async () => {
    // Arrange
    const { evaluateMergeEligibility } = fakeEvaluateMergeEligibility(ELIGIBLE_RESULT);
    const { mergeAdaPullRequest } = fakeMergeAdaPullRequest({ ok: false, reason: "merge_permission_denied" });

    // Act
    const result = await executeEligibleDeliveryMerge({ executionRunId: EXECUTION_RUN_ID, evaluateMergeEligibility, mergeAdaPullRequest });

    // Assert
    expect(result).toEqual({ outcome: "merge_permission_denied", executionRunId: EXECUTION_RUN_ID, repository: REPOSITORY, pullRequestNumber: PULL_REQUEST_NUMBER });
  });

  it("should pass through credential_unavailable from the merge primitive, preserving the credential failure reason", async () => {
    // Arrange
    const { evaluateMergeEligibility } = fakeEvaluateMergeEligibility(ELIGIBLE_RESULT);
    const { mergeAdaPullRequest } = fakeMergeAdaPullRequest({
      ok: false,
      reason: "credential_unavailable",
      credentialReason: "token_exchange_failed",
      httpStatus: 403,
    });

    // Act
    const result = await executeEligibleDeliveryMerge({ executionRunId: EXECUTION_RUN_ID, evaluateMergeEligibility, mergeAdaPullRequest });

    // Assert
    expect(result).toEqual({
      outcome: "credential_unavailable",
      executionRunId: EXECUTION_RUN_ID,
      repository: REPOSITORY,
      pullRequestNumber: PULL_REQUEST_NUMBER,
      credentialReason: "token_exchange_failed",
      httpStatus: 403,
    });
  });

  it("should pass through merge_failed from the merge primitive with the safe http status", async () => {
    // Arrange
    const { evaluateMergeEligibility } = fakeEvaluateMergeEligibility(ELIGIBLE_RESULT);
    const { mergeAdaPullRequest } = fakeMergeAdaPullRequest({ ok: false, reason: "merge_failed", httpStatus: 500 });

    // Act
    const result = await executeEligibleDeliveryMerge({ executionRunId: EXECUTION_RUN_ID, evaluateMergeEligibility, mergeAdaPullRequest });

    // Assert
    expect(result).toEqual({ outcome: "merge_failed", executionRunId: EXECUTION_RUN_ID, repository: REPOSITORY, pullRequestNumber: PULL_REQUEST_NUMBER, httpStatus: 500 });
  });

  it("should pass through merge_network_error from the merge primitive", async () => {
    // Arrange
    const { evaluateMergeEligibility } = fakeEvaluateMergeEligibility(ELIGIBLE_RESULT);
    const { mergeAdaPullRequest } = fakeMergeAdaPullRequest({ ok: false, reason: "merge_network_error" });

    // Act
    const result = await executeEligibleDeliveryMerge({ executionRunId: EXECUTION_RUN_ID, evaluateMergeEligibility, mergeAdaPullRequest });

    // Assert
    expect(result).toEqual({ outcome: "merge_network_error", executionRunId: EXECUTION_RUN_ID, repository: REPOSITORY, pullRequestNumber: PULL_REQUEST_NUMBER });
  });

  it("should pass through invalid_response from the merge primitive, never reporting success on transport success alone", async () => {
    // Arrange
    const { evaluateMergeEligibility } = fakeEvaluateMergeEligibility(ELIGIBLE_RESULT);
    const { mergeAdaPullRequest } = fakeMergeAdaPullRequest({ ok: false, reason: "invalid_response" });

    // Act
    const result = await executeEligibleDeliveryMerge({ executionRunId: EXECUTION_RUN_ID, evaluateMergeEligibility, mergeAdaPullRequest });

    // Assert
    expect(result).toEqual({ outcome: "invalid_response", executionRunId: EXECUTION_RUN_ID, repository: REPOSITORY, pullRequestNumber: PULL_REQUEST_NUMBER });
  });

  it("should never leak credential or raw response data through its result", async () => {
    // Arrange
    const { evaluateMergeEligibility } = fakeEvaluateMergeEligibility(ELIGIBLE_RESULT);
    const { mergeAdaPullRequest } = fakeMergeAdaPullRequest({ ok: true, mergeCommitSha: MERGE_COMMIT_SHA });

    // Act
    const result = await executeEligibleDeliveryMerge({ executionRunId: EXECUTION_RUN_ID, evaluateMergeEligibility, mergeAdaPullRequest });

    // Assert
    expect(JSON.stringify(result)).not.toContain("token");
  });
});
