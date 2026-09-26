import { describe, expect, it } from "vitest";

import { executeEligibleReleaseMerge } from "./releaseMergeExecution";

import type { MergeAdaPullRequest, MergeAdaPullRequestRequest } from "./adaPullRequestMerge";
import type { EvaluateReleaseMergeEligibilityForIntent } from "./releaseMergeExecution";
import type { ReleaseMergeEligibilityOutcome } from "./releaseMergeEligibility";

const RELEASE_INTENT_ID = "release-123";
const TARGET = "main";
const REPOSITORY = "johnpwise/kanban-app";
const PULL_REQUEST_NUMBER = 64;
const HEAD_SHA = "a".repeat(40);
const MERGE_COMMIT_SHA = "c".repeat(40);

const ELIGIBLE_RESULT: ReleaseMergeEligibilityOutcome = {
  eligible: true,
  releaseIntentId: RELEASE_INTENT_ID,
  target: TARGET,
  repository: REPOSITORY,
  pullRequestNumber: PULL_REQUEST_NUMBER,
  headSha: HEAD_SHA,
};

function fakeEvaluateReleaseMergeEligibility(outcome: ReleaseMergeEligibilityOutcome): {
  evaluateReleaseMergeEligibility: EvaluateReleaseMergeEligibilityForIntent;
  calls: Array<{ releaseIntentId: string; target: typeof TARGET }>;
} {
  const calls: Array<{ releaseIntentId: string; target: typeof TARGET }> = [];
  return {
    calls,
    evaluateReleaseMergeEligibility: async (releaseIntentId, target) => {
      calls.push({ releaseIntentId, target });
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

describe("executeEligibleReleaseMerge", () => {
  it("should invoke fresh eligibility with exactly releaseIntentId and target, never a cached/prior result", async () => {
    // Arrange
    const { evaluateReleaseMergeEligibility, calls } = fakeEvaluateReleaseMergeEligibility(ELIGIBLE_RESULT);
    const { mergeAdaPullRequest } = fakeMergeAdaPullRequest({ ok: true, mergeCommitSha: MERGE_COMMIT_SHA });

    // Act
    await executeEligibleReleaseMerge({ releaseIntentId: RELEASE_INTENT_ID, target: TARGET, evaluateReleaseMergeEligibility, mergeAdaPullRequest });

    // Assert
    expect(calls).toEqual([{ releaseIntentId: RELEASE_INTENT_ID, target: TARGET }]);
  });

  it("should attempt no GitHub mutation and return typed not_eligible, preserving the exact eligibility reason, when not eligible", async () => {
    // Arrange
    const notEligible: ReleaseMergeEligibilityOutcome = { eligible: false, reason: "pull_request_head_sha_mismatch", target: TARGET, pullRequestNumber: PULL_REQUEST_NUMBER };
    const { evaluateReleaseMergeEligibility } = fakeEvaluateReleaseMergeEligibility(notEligible);
    const { mergeAdaPullRequest, calls } = fakeMergeAdaPullRequest({ ok: true, mergeCommitSha: MERGE_COMMIT_SHA });

    // Act
    const result = await executeEligibleReleaseMerge({ releaseIntentId: RELEASE_INTENT_ID, target: TARGET, evaluateReleaseMergeEligibility, mergeAdaPullRequest });

    // Assert
    expect(result).toEqual({ outcome: "not_eligible", releaseIntentId: RELEASE_INTENT_ID, target: TARGET, eligibility: notEligible });
    expect(calls).toHaveLength(0);
  });

  it("should call the merge primitive using only the repository/PR number/head SHA from the trusted eligible result, never caller-supplied values", async () => {
    // Arrange
    const { evaluateReleaseMergeEligibility } = fakeEvaluateReleaseMergeEligibility(ELIGIBLE_RESULT);
    const { mergeAdaPullRequest, calls } = fakeMergeAdaPullRequest({ ok: true, mergeCommitSha: MERGE_COMMIT_SHA });

    // Act
    await executeEligibleReleaseMerge({ releaseIntentId: RELEASE_INTENT_ID, target: TARGET, evaluateReleaseMergeEligibility, mergeAdaPullRequest });

    // Assert
    expect(calls).toEqual([{ repository: REPOSITORY, pullRequestNumber: PULL_REQUEST_NUMBER, expectedHeadSha: HEAD_SHA }]);
  });

  it("should call the merge primitive exactly once when freshly eligible", async () => {
    // Arrange
    const { evaluateReleaseMergeEligibility } = fakeEvaluateReleaseMergeEligibility(ELIGIBLE_RESULT);
    const { mergeAdaPullRequest, calls } = fakeMergeAdaPullRequest({ ok: true, mergeCommitSha: MERGE_COMMIT_SHA });

    // Act
    await executeEligibleReleaseMerge({ releaseIntentId: RELEASE_INTENT_ID, target: TARGET, evaluateReleaseMergeEligibility, mergeAdaPullRequest });

    // Assert
    expect(calls).toHaveLength(1);
  });

  it("should return typed merged with the verified release head SHA and GitHub's merge commit SHA, keeping them distinct, on a successful merge", async () => {
    // Arrange
    const { evaluateReleaseMergeEligibility } = fakeEvaluateReleaseMergeEligibility(ELIGIBLE_RESULT);
    const { mergeAdaPullRequest } = fakeMergeAdaPullRequest({ ok: true, mergeCommitSha: MERGE_COMMIT_SHA });

    // Act
    const result = await executeEligibleReleaseMerge({ releaseIntentId: RELEASE_INTENT_ID, target: TARGET, evaluateReleaseMergeEligibility, mergeAdaPullRequest });

    // Assert
    expect(result).toEqual({
      outcome: "merged",
      releaseIntentId: RELEASE_INTENT_ID,
      target: TARGET,
      repository: REPOSITORY,
      pullRequestNumber: PULL_REQUEST_NUMBER,
      headSha: HEAD_SHA,
      mergeCommitSha: MERGE_COMMIT_SHA,
    });
  });

  it("should fail closed with a distinct pull_request_head_changed outcome, and not retry, when the PR head moved between eligibility and the merge attempt", async () => {
    // Arrange
    const { evaluateReleaseMergeEligibility, calls: eligibilityCalls } = fakeEvaluateReleaseMergeEligibility(ELIGIBLE_RESULT);
    const { mergeAdaPullRequest, calls } = fakeMergeAdaPullRequest({ ok: false, reason: "pull_request_head_changed" });

    // Act
    const result = await executeEligibleReleaseMerge({ releaseIntentId: RELEASE_INTENT_ID, target: TARGET, evaluateReleaseMergeEligibility, mergeAdaPullRequest });

    // Assert
    expect(result).toEqual({
      outcome: "pull_request_head_changed",
      releaseIntentId: RELEASE_INTENT_ID,
      target: TARGET,
      repository: REPOSITORY,
      pullRequestNumber: PULL_REQUEST_NUMBER,
      expectedHeadSha: HEAD_SHA,
    });
    expect(calls).toHaveLength(1);
    expect(eligibilityCalls).toHaveLength(1);
  });

  it("should pass through not_mergeable from the merge primitive", async () => {
    // Arrange
    const { evaluateReleaseMergeEligibility } = fakeEvaluateReleaseMergeEligibility(ELIGIBLE_RESULT);
    const { mergeAdaPullRequest } = fakeMergeAdaPullRequest({ ok: false, reason: "not_mergeable" });

    // Act
    const result = await executeEligibleReleaseMerge({ releaseIntentId: RELEASE_INTENT_ID, target: TARGET, evaluateReleaseMergeEligibility, mergeAdaPullRequest });

    // Assert
    expect(result).toEqual({ outcome: "not_mergeable", releaseIntentId: RELEASE_INTENT_ID, target: TARGET, repository: REPOSITORY, pullRequestNumber: PULL_REQUEST_NUMBER });
  });

  it("should pass through merge_permission_denied from the merge primitive", async () => {
    // Arrange
    const { evaluateReleaseMergeEligibility } = fakeEvaluateReleaseMergeEligibility(ELIGIBLE_RESULT);
    const { mergeAdaPullRequest } = fakeMergeAdaPullRequest({ ok: false, reason: "merge_permission_denied" });

    // Act
    const result = await executeEligibleReleaseMerge({ releaseIntentId: RELEASE_INTENT_ID, target: TARGET, evaluateReleaseMergeEligibility, mergeAdaPullRequest });

    // Assert
    expect(result).toEqual({ outcome: "merge_permission_denied", releaseIntentId: RELEASE_INTENT_ID, target: TARGET, repository: REPOSITORY, pullRequestNumber: PULL_REQUEST_NUMBER });
  });

  it("should pass through credential_unavailable from the merge primitive, preserving the credential failure reason", async () => {
    // Arrange
    const { evaluateReleaseMergeEligibility } = fakeEvaluateReleaseMergeEligibility(ELIGIBLE_RESULT);
    const { mergeAdaPullRequest } = fakeMergeAdaPullRequest({
      ok: false,
      reason: "credential_unavailable",
      credentialReason: "token_exchange_failed",
      httpStatus: 403,
    });

    // Act
    const result = await executeEligibleReleaseMerge({ releaseIntentId: RELEASE_INTENT_ID, target: TARGET, evaluateReleaseMergeEligibility, mergeAdaPullRequest });

    // Assert
    expect(result).toEqual({
      outcome: "credential_unavailable",
      releaseIntentId: RELEASE_INTENT_ID,
      target: TARGET,
      repository: REPOSITORY,
      pullRequestNumber: PULL_REQUEST_NUMBER,
      credentialReason: "token_exchange_failed",
      httpStatus: 403,
    });
  });

  it("should pass through merge_failed from the merge primitive with the safe http status", async () => {
    // Arrange
    const { evaluateReleaseMergeEligibility } = fakeEvaluateReleaseMergeEligibility(ELIGIBLE_RESULT);
    const { mergeAdaPullRequest } = fakeMergeAdaPullRequest({ ok: false, reason: "merge_failed", httpStatus: 500 });

    // Act
    const result = await executeEligibleReleaseMerge({ releaseIntentId: RELEASE_INTENT_ID, target: TARGET, evaluateReleaseMergeEligibility, mergeAdaPullRequest });

    // Assert
    expect(result).toEqual({ outcome: "merge_failed", releaseIntentId: RELEASE_INTENT_ID, target: TARGET, repository: REPOSITORY, pullRequestNumber: PULL_REQUEST_NUMBER, httpStatus: 500 });
  });

  it("should pass through merge_network_error from the merge primitive", async () => {
    // Arrange
    const { evaluateReleaseMergeEligibility } = fakeEvaluateReleaseMergeEligibility(ELIGIBLE_RESULT);
    const { mergeAdaPullRequest } = fakeMergeAdaPullRequest({ ok: false, reason: "merge_network_error" });

    // Act
    const result = await executeEligibleReleaseMerge({ releaseIntentId: RELEASE_INTENT_ID, target: TARGET, evaluateReleaseMergeEligibility, mergeAdaPullRequest });

    // Assert
    expect(result).toEqual({ outcome: "merge_network_error", releaseIntentId: RELEASE_INTENT_ID, target: TARGET, repository: REPOSITORY, pullRequestNumber: PULL_REQUEST_NUMBER });
  });

  it("should pass through invalid_response from the merge primitive, never reporting success on transport success alone", async () => {
    // Arrange
    const { evaluateReleaseMergeEligibility } = fakeEvaluateReleaseMergeEligibility(ELIGIBLE_RESULT);
    const { mergeAdaPullRequest } = fakeMergeAdaPullRequest({ ok: false, reason: "invalid_response" });

    // Act
    const result = await executeEligibleReleaseMerge({ releaseIntentId: RELEASE_INTENT_ID, target: TARGET, evaluateReleaseMergeEligibility, mergeAdaPullRequest });

    // Assert
    expect(result).toEqual({ outcome: "invalid_response", releaseIntentId: RELEASE_INTENT_ID, target: TARGET, repository: REPOSITORY, pullRequestNumber: PULL_REQUEST_NUMBER });
  });

  it("should return a distinct already_merged outcome carrying the trusted verified head SHA and mergeCommitSha, with zero GitHub mutation, for the already-merged recovery path", async () => {
    // Arrange
    const alreadyMerged: ReleaseMergeEligibilityOutcome = {
      eligible: false,
      reason: "pull_request_already_merged",
      releaseIntentId: RELEASE_INTENT_ID,
      target: TARGET,
      repository: REPOSITORY,
      pullRequestNumber: PULL_REQUEST_NUMBER,
      headSha: HEAD_SHA,
      mergeCommitSha: MERGE_COMMIT_SHA,
    };
    const { evaluateReleaseMergeEligibility } = fakeEvaluateReleaseMergeEligibility(alreadyMerged);
    const { mergeAdaPullRequest, calls } = fakeMergeAdaPullRequest({ ok: true, mergeCommitSha: MERGE_COMMIT_SHA });

    // Act
    const result = await executeEligibleReleaseMerge({ releaseIntentId: RELEASE_INTENT_ID, target: TARGET, evaluateReleaseMergeEligibility, mergeAdaPullRequest });

    // Assert
    expect(result).toEqual({
      outcome: "already_merged",
      releaseIntentId: RELEASE_INTENT_ID,
      target: TARGET,
      repository: REPOSITORY,
      pullRequestNumber: PULL_REQUEST_NUMBER,
      headSha: HEAD_SHA,
      mergeCommitSha: MERGE_COMMIT_SHA,
    });
    expect(calls).toHaveLength(0);
  });

  it("should pass through an already-merged mismatch reason as an ordinary not_eligible failure, never a successful recovery", async () => {
    // Arrange
    const mismatched: ReleaseMergeEligibilityOutcome = {
      eligible: false,
      reason: "pull_request_already_merged_head_sha_mismatch",
      target: TARGET,
      pullRequestNumber: PULL_REQUEST_NUMBER,
    };
    const { evaluateReleaseMergeEligibility } = fakeEvaluateReleaseMergeEligibility(mismatched);
    const { mergeAdaPullRequest, calls } = fakeMergeAdaPullRequest({ ok: true, mergeCommitSha: MERGE_COMMIT_SHA });

    // Act
    const result = await executeEligibleReleaseMerge({ releaseIntentId: RELEASE_INTENT_ID, target: TARGET, evaluateReleaseMergeEligibility, mergeAdaPullRequest });

    // Assert
    expect(result).toEqual({ outcome: "not_eligible", releaseIntentId: RELEASE_INTENT_ID, target: TARGET, eligibility: mismatched });
    expect(calls).toHaveLength(0);
  });

  it("should never leak credential or raw response data through its result", async () => {
    // Arrange
    const { evaluateReleaseMergeEligibility } = fakeEvaluateReleaseMergeEligibility(ELIGIBLE_RESULT);
    const { mergeAdaPullRequest } = fakeMergeAdaPullRequest({ ok: true, mergeCommitSha: MERGE_COMMIT_SHA });

    // Act
    const result = await executeEligibleReleaseMerge({ releaseIntentId: RELEASE_INTENT_ID, target: TARGET, evaluateReleaseMergeEligibility, mergeAdaPullRequest });

    // Assert
    expect(JSON.stringify(result)).not.toContain("token");
  });
});
