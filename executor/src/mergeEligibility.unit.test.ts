import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";

import { evaluateMergeEligibility } from "./mergeEligibility";
import { createFakeExecutionRunRepository } from "./testHelpers/fakeExecutionRunRepository";

import type { ObserveDeliveryPullRequest, ObservedPullRequest } from "./deliveryPullRequestObservation";

const EXECUTION_RUN_ID = "req-123";
const REPOSITORY = "johnpwise/kanban-app";
const DELIVERY_BRANCH = "ada/req-123";
const DELIVERY_COMMIT_SHA = "a".repeat(40);
const OTHER_COMMIT_SHA = "b".repeat(40);
const BASE_BRANCH = "develop";
const PULL_REQUEST_NUMBER = 42;

function validExecutionRunData(overrides: Record<string, unknown> = {}) {
  return {
    executionRequestId: EXECUTION_RUN_ID,
    correlationId: "corr-1",
    projectId: "project-1",
    cardId: "card-1",
    status: "ci_succeeded",
    acceptedAt: Timestamp.now(),
    input: {
      schemaVersion: 1,
      eventType: "ada.execution.requested",
      title: "Add real-time card sync",
      prompt: "Do the thing",
      repository: REPOSITORY,
      baseBranch: BASE_BRANCH,
      requestedBy: "user-1",
      requestedAt: "2026-09-20T00:00:00.000Z",
    },
    delivery: {
      branch: DELIVERY_BRANCH,
      commitSha: DELIVERY_COMMIT_SHA,
      recordedAt: Timestamp.now(),
      pullRequest: { number: PULL_REQUEST_NUMBER, htmlUrl: `https://github.com/${REPOSITORY}/pull/${PULL_REQUEST_NUMBER}` },
    },
    ci: {
      commitSha: DELIVERY_COMMIT_SHA,
      state: "succeeded",
      runId: 501,
      htmlUrl: `https://github.com/${REPOSITORY}/actions/runs/501`,
      recordedAt: Timestamp.now(),
    },
    ...overrides,
  };
}

function observedPullRequest(overrides: Partial<ObservedPullRequest> = {}): ObservedPullRequest {
  return {
    number: PULL_REQUEST_NUMBER,
    state: "open",
    merged: false,
    draft: false,
    headSha: DELIVERY_COMMIT_SHA,
    headRef: DELIVERY_BRANCH,
    headRepositoryFullName: REPOSITORY,
    baseRef: BASE_BRANCH,
    baseRepositoryFullName: REPOSITORY,
    mergeable: true,
    mergeCommitSha: null,
    ...overrides,
  };
}

function fakeObservePullRequest(
  outcome:
    | { ok: true; pullRequest: ObservedPullRequest }
    | { ok: false; reason: string; [key: string]: unknown },
): { observePullRequest: ObserveDeliveryPullRequest; calls: { repository: string; pullRequestNumber: number }[] } {
  const calls: { repository: string; pullRequestNumber: number }[] = [];
  return {
    calls,
    observePullRequest: (async (request) => {
      calls.push(request);
      return outcome as never;
    }) as ObserveDeliveryPullRequest,
  };
}

describe("evaluateMergeEligibility", () => {
  it("should return eligible for a durable delivery whose live PR head still matches exactly", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: validExecutionRunData() });
    const { observePullRequest, calls } = fakeObservePullRequest({ ok: true, pullRequest: observedPullRequest() });

    // Act
    const result = await evaluateMergeEligibility({ executionRunId: EXECUTION_RUN_ID, repository, observePullRequest });

    // Assert
    expect(result).toEqual({
      eligible: true,
      executionRunId: EXECUTION_RUN_ID,
      repository: REPOSITORY,
      commitSha: DELIVERY_COMMIT_SHA,
      pullRequestNumber: PULL_REQUEST_NUMBER,
    });
    expect(calls).toEqual([{ repository: REPOSITORY, pullRequestNumber: PULL_REQUEST_NUMBER }]);
  });

  describe("durable-state failures (fail closed before any GitHub call)", () => {
    it("should return execution_run_load_error when loading the run throws", async () => {
      const { repository } = createFakeExecutionRunRepository({ throwError: new Error("firestore down") });
      const { observePullRequest, calls } = fakeObservePullRequest({ ok: true, pullRequest: observedPullRequest() });

      const result = await evaluateMergeEligibility({ executionRunId: EXECUTION_RUN_ID, repository, observePullRequest });

      expect(result).toEqual({ eligible: false, reason: "execution_run_load_error" });
      expect(calls).toHaveLength(0);
    });

    it("should return execution_run_not_found when no such document exists", async () => {
      const { repository } = createFakeExecutionRunRepository({ data: undefined });
      const { observePullRequest, calls } = fakeObservePullRequest({ ok: true, pullRequest: observedPullRequest() });

      const result = await evaluateMergeEligibility({ executionRunId: EXECUTION_RUN_ID, repository, observePullRequest });

      expect(result).toEqual({ eligible: false, reason: "execution_run_not_found" });
      expect(calls).toHaveLength(0);
    });

    it("should return execution_run_invalid when the persisted document fails schema validation", async () => {
      const { repository } = createFakeExecutionRunRepository({ data: { executionRequestId: EXECUTION_RUN_ID } });
      const { observePullRequest, calls } = fakeObservePullRequest({ ok: true, pullRequest: observedPullRequest() });

      const result = await evaluateMergeEligibility({ executionRunId: EXECUTION_RUN_ID, repository, observePullRequest });

      expect(result).toEqual({ eligible: false, reason: "execution_run_invalid" });
      expect(calls).toHaveLength(0);
    });

    it("should return status_not_ci_succeeded when status is not exactly ci_succeeded", async () => {
      const { repository } = createFakeExecutionRunRepository({ data: validExecutionRunData({ status: "accepted", delivery: undefined, ci: undefined }) });
      const { observePullRequest, calls } = fakeObservePullRequest({ ok: true, pullRequest: observedPullRequest() });

      const result = await evaluateMergeEligibility({ executionRunId: EXECUTION_RUN_ID, repository, observePullRequest });

      expect(result).toEqual({ eligible: false, reason: "status_not_ci_succeeded", status: "accepted" });
      expect(calls).toHaveLength(0);
    });

    it("should return status_not_ci_succeeded for ci_failed even when delivery/ci happen to be present", async () => {
      const { repository } = createFakeExecutionRunRepository({
        data: validExecutionRunData({ status: "ci_failed", ci: { commitSha: DELIVERY_COMMIT_SHA, state: "failed", runId: 501, htmlUrl: "x", recordedAt: Timestamp.now() } }),
      });
      const { observePullRequest, calls } = fakeObservePullRequest({ ok: true, pullRequest: observedPullRequest() });

      const result = await evaluateMergeEligibility({ executionRunId: EXECUTION_RUN_ID, repository, observePullRequest });

      expect(result).toEqual({ eligible: false, reason: "status_not_ci_succeeded", status: "ci_failed" });
      expect(calls).toHaveLength(0);
    });

    it("should return delivery_missing when no delivery is persisted", async () => {
      const { repository } = createFakeExecutionRunRepository({ data: validExecutionRunData({ delivery: undefined }) });
      const { observePullRequest, calls } = fakeObservePullRequest({ ok: true, pullRequest: observedPullRequest() });

      const result = await evaluateMergeEligibility({ executionRunId: EXECUTION_RUN_ID, repository, observePullRequest });

      expect(result).toEqual({ eligible: false, reason: "delivery_missing" });
      expect(calls).toHaveLength(0);
    });

    it("should return pull_request_identity_missing when delivery has no pullRequest", async () => {
      const { repository } = createFakeExecutionRunRepository({
        data: validExecutionRunData({ delivery: { branch: DELIVERY_BRANCH, commitSha: DELIVERY_COMMIT_SHA, recordedAt: Timestamp.now() } }),
      });
      const { observePullRequest, calls } = fakeObservePullRequest({ ok: true, pullRequest: observedPullRequest() });

      const result = await evaluateMergeEligibility({ executionRunId: EXECUTION_RUN_ID, repository, observePullRequest });

      expect(result).toEqual({ eligible: false, reason: "pull_request_identity_missing" });
      expect(calls).toHaveLength(0);
    });

    it("should return ci_missing when no ci result is persisted, even though status claims ci_succeeded", async () => {
      const { repository } = createFakeExecutionRunRepository({ data: validExecutionRunData({ ci: undefined }) });
      const { observePullRequest, calls } = fakeObservePullRequest({ ok: true, pullRequest: observedPullRequest() });

      const result = await evaluateMergeEligibility({ executionRunId: EXECUTION_RUN_ID, repository, observePullRequest });

      expect(result).toEqual({ eligible: false, reason: "ci_missing" });
      expect(calls).toHaveLength(0);
    });

    it("should return ci_not_succeeded when ci.state contradicts a status claiming ci_succeeded", async () => {
      const { repository } = createFakeExecutionRunRepository({
        data: validExecutionRunData({ ci: { commitSha: DELIVERY_COMMIT_SHA, state: "failed", runId: 501, htmlUrl: "x", recordedAt: Timestamp.now() } }),
      });
      const { observePullRequest, calls } = fakeObservePullRequest({ ok: true, pullRequest: observedPullRequest() });

      const result = await evaluateMergeEligibility({ executionRunId: EXECUTION_RUN_ID, repository, observePullRequest });

      expect(result).toEqual({ eligible: false, reason: "ci_not_succeeded", state: "failed" });
      expect(calls).toHaveLength(0);
    });

    it("should return ci_delivery_sha_mismatch when ci.commitSha disagrees with delivery.commitSha", async () => {
      const { repository } = createFakeExecutionRunRepository({
        data: validExecutionRunData({ ci: { commitSha: OTHER_COMMIT_SHA, state: "succeeded", runId: 501, htmlUrl: "x", recordedAt: Timestamp.now() } }),
      });
      const { observePullRequest, calls } = fakeObservePullRequest({ ok: true, pullRequest: observedPullRequest() });

      const result = await evaluateMergeEligibility({ executionRunId: EXECUTION_RUN_ID, repository, observePullRequest });

      expect(result).toEqual({ eligible: false, reason: "ci_delivery_sha_mismatch" });
      expect(calls).toHaveLength(0);
    });
  });

  describe("live GitHub reconciliation", () => {
    it("should reconcile using the persisted PR number, never rediscovering a PR by branch", async () => {
      const { repository } = createFakeExecutionRunRepository({ data: validExecutionRunData() });
      const { observePullRequest, calls } = fakeObservePullRequest({ ok: true, pullRequest: observedPullRequest() });

      await evaluateMergeEligibility({ executionRunId: EXECUTION_RUN_ID, repository, observePullRequest });

      expect(calls).toEqual([{ repository: REPOSITORY, pullRequestNumber: PULL_REQUEST_NUMBER }]);
    });

    it("should return credential_unavailable, passing through the credential failure reason", async () => {
      const { repository } = createFakeExecutionRunRepository({ data: validExecutionRunData() });
      const { observePullRequest } = fakeObservePullRequest({
        ok: false,
        reason: "credential_unavailable",
        credentialReason: "token_exchange_failed",
        httpStatus: 403,
      });

      const result = await evaluateMergeEligibility({ executionRunId: EXECUTION_RUN_ID, repository, observePullRequest });

      expect(result).toEqual({
        eligible: false,
        reason: "credential_unavailable",
        credentialReason: "token_exchange_failed",
        httpStatus: 403,
      });
    });

    it("should return pull_request_lookup_failed with the safe http status", async () => {
      const { repository } = createFakeExecutionRunRepository({ data: validExecutionRunData() });
      const { observePullRequest } = fakeObservePullRequest({ ok: false, reason: "pull_request_lookup_failed", httpStatus: 404 });

      const result = await evaluateMergeEligibility({ executionRunId: EXECUTION_RUN_ID, repository, observePullRequest });

      expect(result).toEqual({ eligible: false, reason: "pull_request_lookup_failed", httpStatus: 404 });
    });

    it("should return pull_request_lookup_network_error", async () => {
      const { repository } = createFakeExecutionRunRepository({ data: validExecutionRunData() });
      const { observePullRequest } = fakeObservePullRequest({ ok: false, reason: "pull_request_lookup_network_error" });

      const result = await evaluateMergeEligibility({ executionRunId: EXECUTION_RUN_ID, repository, observePullRequest });

      expect(result).toEqual({ eligible: false, reason: "pull_request_lookup_network_error" });
    });

    it("should return pull_request_response_invalid", async () => {
      const { repository } = createFakeExecutionRunRepository({ data: validExecutionRunData() });
      const { observePullRequest } = fakeObservePullRequest({ ok: false, reason: "pull_request_response_invalid" });

      const result = await evaluateMergeEligibility({ executionRunId: EXECUTION_RUN_ID, repository, observePullRequest });

      expect(result).toEqual({ eligible: false, reason: "pull_request_response_invalid" });
    });

    it("should reconcile an already-merged PR whose live identity still agrees with the durable delivery, exposing recoverable merge identity", async () => {
      const MERGE_COMMIT_SHA = "c".repeat(40);
      const { repository } = createFakeExecutionRunRepository({ data: validExecutionRunData() });
      const { observePullRequest } = fakeObservePullRequest({
        ok: true,
        pullRequest: observedPullRequest({ state: "closed", merged: true, mergeCommitSha: MERGE_COMMIT_SHA }),
      });

      const result = await evaluateMergeEligibility({ executionRunId: EXECUTION_RUN_ID, repository, observePullRequest });

      expect(result).toEqual({
        eligible: false,
        reason: "pull_request_already_merged",
        executionRunId: EXECUTION_RUN_ID,
        repository: REPOSITORY,
        pullRequestNumber: PULL_REQUEST_NUMBER,
        deliveryCommitSha: DELIVERY_COMMIT_SHA,
        mergeCommitSha: MERGE_COMMIT_SHA,
      });
    });

    it("should fail closed with a distinct mismatch reason — never a successful recovery — when an already-merged PR's head SHA disagrees with the durable delivery", async () => {
      const { repository } = createFakeExecutionRunRepository({ data: validExecutionRunData() });
      const { observePullRequest } = fakeObservePullRequest({
        ok: true,
        pullRequest: observedPullRequest({ state: "closed", merged: true, mergeCommitSha: "c".repeat(40), headSha: OTHER_COMMIT_SHA }),
      });

      const result = await evaluateMergeEligibility({ executionRunId: EXECUTION_RUN_ID, repository, observePullRequest });

      expect(result).toEqual({ eligible: false, reason: "pull_request_already_merged_head_sha_mismatch" });
    });

    it("should fail closed with a distinct mismatch reason when an already-merged PR's head branch disagrees with the durable delivery", async () => {
      const { repository } = createFakeExecutionRunRepository({ data: validExecutionRunData() });
      const { observePullRequest } = fakeObservePullRequest({
        ok: true,
        pullRequest: observedPullRequest({ state: "closed", merged: true, mergeCommitSha: "c".repeat(40), headRef: "some-other-branch" }),
      });

      const result = await evaluateMergeEligibility({ executionRunId: EXECUTION_RUN_ID, repository, observePullRequest });

      expect(result).toEqual({ eligible: false, reason: "pull_request_already_merged_head_branch_mismatch" });
    });

    it("should fail closed with a distinct mismatch reason when an already-merged PR's base branch disagrees with the requested base", async () => {
      const { repository } = createFakeExecutionRunRepository({ data: validExecutionRunData() });
      const { observePullRequest } = fakeObservePullRequest({
        ok: true,
        pullRequest: observedPullRequest({ state: "closed", merged: true, mergeCommitSha: "c".repeat(40), baseRef: "main" }),
      });

      const result = await evaluateMergeEligibility({ executionRunId: EXECUTION_RUN_ID, repository, observePullRequest });

      expect(result).toEqual({ eligible: false, reason: "pull_request_already_merged_base_branch_mismatch" });
    });

    it("should fail closed with a distinct reason — never a successful recovery — when an already-merged PR reports no merge commit SHA at all", async () => {
      const { repository } = createFakeExecutionRunRepository({ data: validExecutionRunData() });
      const { observePullRequest } = fakeObservePullRequest({
        ok: true,
        pullRequest: observedPullRequest({ state: "closed", merged: true, mergeCommitSha: null }),
      });

      const result = await evaluateMergeEligibility({ executionRunId: EXECUTION_RUN_ID, repository, observePullRequest });

      expect(result).toEqual({ eligible: false, reason: "pull_request_already_merged_commit_sha_missing" });
    });

    it("should fail closed on pull_request_repository_mismatch even when the PR is already merged, never treating a mismatched fork's merge as recovery", async () => {
      const { repository } = createFakeExecutionRunRepository({ data: validExecutionRunData() });
      const { observePullRequest } = fakeObservePullRequest({
        ok: true,
        pullRequest: observedPullRequest({ state: "closed", merged: true, mergeCommitSha: "c".repeat(40), headRepositoryFullName: "someone-else/kanban-app" }),
      });

      const result = await evaluateMergeEligibility({ executionRunId: EXECUTION_RUN_ID, repository, observePullRequest });

      expect(result).toEqual({ eligible: false, reason: "pull_request_repository_mismatch" });
    });

    it("should return pull_request_closed for a closed, unmerged PR", async () => {
      const { repository } = createFakeExecutionRunRepository({ data: validExecutionRunData() });
      const { observePullRequest } = fakeObservePullRequest({
        ok: true,
        pullRequest: observedPullRequest({ state: "closed", merged: false }),
      });

      const result = await evaluateMergeEligibility({ executionRunId: EXECUTION_RUN_ID, repository, observePullRequest });

      expect(result).toEqual({ eligible: false, reason: "pull_request_closed" });
    });

    it("should return pull_request_draft for an open draft PR", async () => {
      const { repository } = createFakeExecutionRunRepository({ data: validExecutionRunData() });
      const { observePullRequest } = fakeObservePullRequest({
        ok: true,
        pullRequest: observedPullRequest({ draft: true }),
      });

      const result = await evaluateMergeEligibility({ executionRunId: EXECUTION_RUN_ID, repository, observePullRequest });

      expect(result).toEqual({ eligible: false, reason: "pull_request_draft" });
    });

    it("should return pull_request_repository_mismatch when the head repository is a fork", async () => {
      const { repository } = createFakeExecutionRunRepository({ data: validExecutionRunData() });
      const { observePullRequest } = fakeObservePullRequest({
        ok: true,
        pullRequest: observedPullRequest({ headRepositoryFullName: "someone-else/kanban-app" }),
      });

      const result = await evaluateMergeEligibility({ executionRunId: EXECUTION_RUN_ID, repository, observePullRequest });

      expect(result).toEqual({ eligible: false, reason: "pull_request_repository_mismatch" });
    });

    it("should return pull_request_repository_mismatch when the head repository is missing entirely", async () => {
      const { repository } = createFakeExecutionRunRepository({ data: validExecutionRunData() });
      const { observePullRequest } = fakeObservePullRequest({
        ok: true,
        pullRequest: observedPullRequest({ headRepositoryFullName: null }),
      });

      const result = await evaluateMergeEligibility({ executionRunId: EXECUTION_RUN_ID, repository, observePullRequest });

      expect(result).toEqual({ eligible: false, reason: "pull_request_repository_mismatch" });
    });

    it("should return pull_request_repository_mismatch when the base repository differs", async () => {
      const { repository } = createFakeExecutionRunRepository({ data: validExecutionRunData() });
      const { observePullRequest } = fakeObservePullRequest({
        ok: true,
        pullRequest: observedPullRequest({ baseRepositoryFullName: "someone-else/kanban-app" }),
      });

      const result = await evaluateMergeEligibility({ executionRunId: EXECUTION_RUN_ID, repository, observePullRequest });

      expect(result).toEqual({ eligible: false, reason: "pull_request_repository_mismatch" });
    });

    it("should return pull_request_head_sha_mismatch — the key regression case — when the live PR head has moved", async () => {
      const { repository } = createFakeExecutionRunRepository({ data: validExecutionRunData() });
      const { observePullRequest } = fakeObservePullRequest({
        ok: true,
        pullRequest: observedPullRequest({ headSha: OTHER_COMMIT_SHA }),
      });

      const result = await evaluateMergeEligibility({ executionRunId: EXECUTION_RUN_ID, repository, observePullRequest });

      expect(result).toEqual({ eligible: false, reason: "pull_request_head_sha_mismatch" });
    });

    it("should return pull_request_head_branch_mismatch when the live PR head ref no longer matches delivery.branch", async () => {
      const { repository } = createFakeExecutionRunRepository({ data: validExecutionRunData() });
      const { observePullRequest } = fakeObservePullRequest({
        ok: true,
        pullRequest: observedPullRequest({ headRef: "some-other-branch" }),
      });

      const result = await evaluateMergeEligibility({ executionRunId: EXECUTION_RUN_ID, repository, observePullRequest });

      expect(result).toEqual({ eligible: false, reason: "pull_request_head_branch_mismatch" });
    });

    it("should return pull_request_base_branch_mismatch when the PR has been retargeted", async () => {
      const { repository } = createFakeExecutionRunRepository({ data: validExecutionRunData() });
      const { observePullRequest } = fakeObservePullRequest({
        ok: true,
        pullRequest: observedPullRequest({ baseRef: "main" }),
      });

      const result = await evaluateMergeEligibility({ executionRunId: EXECUTION_RUN_ID, repository, observePullRequest });

      expect(result).toEqual({ eligible: false, reason: "pull_request_base_branch_mismatch" });
    });

    it("should return mergeability_pending, distinct from not_mergeable, when GitHub has not finished computing mergeability", async () => {
      const { repository } = createFakeExecutionRunRepository({ data: validExecutionRunData() });
      const { observePullRequest } = fakeObservePullRequest({
        ok: true,
        pullRequest: observedPullRequest({ mergeable: null }),
      });

      const result = await evaluateMergeEligibility({ executionRunId: EXECUTION_RUN_ID, repository, observePullRequest });

      expect(result).toEqual({ eligible: false, reason: "mergeability_pending" });
    });

    it("should return not_mergeable for a genuine merge conflict", async () => {
      const { repository } = createFakeExecutionRunRepository({ data: validExecutionRunData() });
      const { observePullRequest } = fakeObservePullRequest({
        ok: true,
        pullRequest: observedPullRequest({ mergeable: false }),
      });

      const result = await evaluateMergeEligibility({ executionRunId: EXECUTION_RUN_ID, repository, observePullRequest });

      expect(result).toEqual({ eligible: false, reason: "not_mergeable" });
    });
  });

  it("should never leak the minted credential or raw response bodies through its result", async () => {
    const { repository } = createFakeExecutionRunRepository({ data: validExecutionRunData() });
    const { observePullRequest } = fakeObservePullRequest({ ok: true, pullRequest: observedPullRequest() });

    const result = await evaluateMergeEligibility({ executionRunId: EXECUTION_RUN_ID, repository, observePullRequest });

    expect(JSON.stringify(result)).not.toContain("token");
  });
});
