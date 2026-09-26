import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, it, vi } from "vitest";

import { observeReleaseCiForReleasePullRequest } from "./releasePullRequestCiObservation";

import type { ObserveGithubPullRequest, ObservedPullRequest } from "./githubPullRequestObservation";
import type { ObserveReleaseCiStatus } from "./releaseCiObservation";
import type { ReleaseIntentRepository } from "./releaseIntentRepository";

const REPOSITORY = "johnpwise/kanban-app";
const RELEASE_INTENT_ID = "johnpwise__kanban-app--0.1.1";
const VERSION = "0.1.1";
const SOURCE_BRANCH = "develop";
const SOURCE_REVISION = "a".repeat(40);
const RELEASE_BRANCH = "release/0.1.1";
const RELEASE_COMMIT_SHA = "c".repeat(40);
const MAIN_PR_NUMBER = 64;

const validIntentDocument = {
  releaseIntentId: RELEASE_INTENT_ID,
  repository: REPOSITORY,
  version: VERSION,
  sourceBranch: SOURCE_BRANCH,
  sourceRevision: SOURCE_REVISION,
  requestedAt: Timestamp.fromMillis(0),
  start: { releaseBranch: RELEASE_BRANCH, commitSha: RELEASE_COMMIT_SHA, recordedAt: Timestamp.fromMillis(0) },
  pullRequests: {
    main: {
      number: MAIN_PR_NUMBER,
      baseBranch: "main",
      headBranch: RELEASE_BRANCH,
      headSha: RELEASE_COMMIT_SHA,
      recordedAt: Timestamp.fromMillis(0),
    },
  },
};

function fakeRepository(data: unknown, throwError?: Error): ReleaseIntentRepository {
  return {
    loadReleaseIntentData: vi.fn(async () => {
      if (throwError) throw throwError;
      return data;
    }),
  } as unknown as ReleaseIntentRepository;
}

const RECONCILED_PULL_REQUEST: ObservedPullRequest = {
  number: MAIN_PR_NUMBER,
  state: "open",
  merged: false,
  draft: false,
  headSha: RELEASE_COMMIT_SHA,
  headRef: RELEASE_BRANCH,
  headRepositoryFullName: REPOSITORY,
  baseRef: "main",
  baseRepositoryFullName: REPOSITORY,
  mergeable: true,
  mergeCommitSha: null,
};

function fakeObserveGithubPullRequest(outcome: Awaited<ReturnType<ObserveGithubPullRequest>>): ObserveGithubPullRequest {
  return vi.fn(async () => outcome);
}

function fakeObserveReleaseCiStatus(outcome: Awaited<ReturnType<ObserveReleaseCiStatus>>): ObserveReleaseCiStatus {
  return vi.fn(async () => outcome);
}

const CI_SUCCEEDED_STATUS = fakeObserveReleaseCiStatus({
  ok: true,
  state: "succeeded",
  runId: 501,
  htmlUrl: "https://github.com/johnpwise/kanban-app/actions/runs/501",
});

describe("observeReleaseCiForReleasePullRequest", () => {
  it("should report ci_succeeded when the persisted PR reconciles fresh and CI is a trusted success", async () => {
    // Arrange
    const repository = fakeRepository(validIntentDocument);
    const observeGithubPullRequest = fakeObserveGithubPullRequest({ ok: true, pullRequest: RECONCILED_PULL_REQUEST });

    // Act
    const result = await observeReleaseCiForReleasePullRequest({
      releaseIntentId: RELEASE_INTENT_ID,
      target: "main",
      repository,
      observeGithubPullRequest,
      observeReleaseCiStatus: CI_SUCCEEDED_STATUS,
    });

    // Assert
    expect(result).toEqual({
      outcome: "ci_succeeded",
      releaseIntentId: RELEASE_INTENT_ID,
      target: "main",
      number: MAIN_PR_NUMBER,
      runId: 501,
      htmlUrl: "https://github.com/johnpwise/kanban-app/actions/runs/501",
    });
    expect(CI_SUCCEEDED_STATUS).toHaveBeenCalledWith({
      repository: REPOSITORY,
      expectedIdentity: { prNumber: MAIN_PR_NUMBER, baseBranch: "main", headBranch: RELEASE_BRANCH, headSha: RELEASE_COMMIT_SHA },
    });
  });

  it("should report ci_pending when CI is queued", async () => {
    // Arrange
    const repository = fakeRepository(validIntentDocument);
    const observeGithubPullRequest = fakeObserveGithubPullRequest({ ok: true, pullRequest: RECONCILED_PULL_REQUEST });
    const observeReleaseCiStatus = fakeObserveReleaseCiStatus({ ok: true, state: "pending" });

    // Act
    const result = await observeReleaseCiForReleasePullRequest({
      releaseIntentId: RELEASE_INTENT_ID,
      target: "main",
      repository,
      observeGithubPullRequest,
      observeReleaseCiStatus,
    });

    // Assert
    expect(result).toEqual({ outcome: "ci_pending", releaseIntentId: RELEASE_INTENT_ID, target: "main", number: MAIN_PR_NUMBER });
  });

  it("should report ci_failed with the runId/htmlUrl/conclusion when CI failed", async () => {
    // Arrange
    const repository = fakeRepository(validIntentDocument);
    const observeGithubPullRequest = fakeObserveGithubPullRequest({ ok: true, pullRequest: RECONCILED_PULL_REQUEST });
    const observeReleaseCiStatus = fakeObserveReleaseCiStatus({
      ok: true,
      state: "failed",
      runId: 502,
      htmlUrl: "https://github.com/johnpwise/kanban-app/actions/runs/502",
      conclusion: "failure",
    });

    // Act
    const result = await observeReleaseCiForReleasePullRequest({
      releaseIntentId: RELEASE_INTENT_ID,
      target: "main",
      repository,
      observeGithubPullRequest,
      observeReleaseCiStatus,
    });

    // Assert
    expect(result).toEqual({
      outcome: "ci_failed",
      releaseIntentId: RELEASE_INTENT_ID,
      target: "main",
      number: MAIN_PR_NUMBER,
      runId: 502,
      htmlUrl: "https://github.com/johnpwise/kanban-app/actions/runs/502",
      conclusion: "failure",
    });
  });

  it("should report ci_unbound when only legacy/unbindable CI evidence exists for this SHA", async () => {
    // Arrange — mirrors the real live 0.1.1 runs, which predate the run-name identity contract.
    const repository = fakeRepository(validIntentDocument);
    const observeGithubPullRequest = fakeObserveGithubPullRequest({ ok: true, pullRequest: RECONCILED_PULL_REQUEST });
    const observeReleaseCiStatus = fakeObserveReleaseCiStatus({ ok: true, state: "unbound" });

    // Act
    const result = await observeReleaseCiForReleasePullRequest({
      releaseIntentId: RELEASE_INTENT_ID,
      target: "main",
      repository,
      observeGithubPullRequest,
      observeReleaseCiStatus,
    });

    // Assert
    expect(result).toEqual({ outcome: "ci_unbound", releaseIntentId: RELEASE_INTENT_ID, target: "main", number: MAIN_PR_NUMBER });
  });

  it("should report ci_observation_failed, passing through the failure reason, and never call CI observation before reconciliation would have failed", async () => {
    // Arrange
    const repository = fakeRepository(validIntentDocument);
    const observeGithubPullRequest = fakeObserveGithubPullRequest({ ok: true, pullRequest: RECONCILED_PULL_REQUEST });
    const observeReleaseCiStatus = fakeObserveReleaseCiStatus({ ok: false, reason: "runs_lookup_failed", httpStatus: 500 });

    // Act
    const result = await observeReleaseCiForReleasePullRequest({
      releaseIntentId: RELEASE_INTENT_ID,
      target: "main",
      repository,
      observeGithubPullRequest,
      observeReleaseCiStatus,
    });

    // Assert
    expect(result).toEqual({
      outcome: "ci_observation_failed",
      releaseIntentId: RELEASE_INTENT_ID,
      target: "main",
      number: MAIN_PR_NUMBER,
      reason: "runs_lookup_failed",
      httpStatus: 500,
    });
  });

  it("should fail closed with release_intent_load_error on an unexpected repository load failure", async () => {
    // Arrange
    const repository = fakeRepository(undefined, new Error("firestore unavailable"));
    const observeGithubPullRequest = fakeObserveGithubPullRequest({ ok: true, pullRequest: RECONCILED_PULL_REQUEST });

    // Act
    const result = await observeReleaseCiForReleasePullRequest({
      releaseIntentId: RELEASE_INTENT_ID,
      target: "main",
      repository,
      observeGithubPullRequest,
      observeReleaseCiStatus: CI_SUCCEEDED_STATUS,
    });

    // Assert
    expect(result).toEqual({ outcome: "release_intent_load_error", releaseIntentId: RELEASE_INTENT_ID, target: "main" });
  });

  it("should fail closed with release_intent_not_found when no such release intent exists", async () => {
    // Arrange
    const repository = fakeRepository(undefined);
    const observeGithubPullRequest = fakeObserveGithubPullRequest({ ok: true, pullRequest: RECONCILED_PULL_REQUEST });

    // Act
    const result = await observeReleaseCiForReleasePullRequest({
      releaseIntentId: RELEASE_INTENT_ID,
      target: "main",
      repository,
      observeGithubPullRequest,
      observeReleaseCiStatus: CI_SUCCEEDED_STATUS,
    });

    // Assert
    expect(result).toEqual({ outcome: "release_intent_not_found", releaseIntentId: RELEASE_INTENT_ID, target: "main" });
  });

  it("should fail closed with release_intent_invalid when the persisted document fails schema validation", async () => {
    // Arrange
    const repository = fakeRepository({ releaseIntentId: RELEASE_INTENT_ID });
    const observeGithubPullRequest = fakeObserveGithubPullRequest({ ok: true, pullRequest: RECONCILED_PULL_REQUEST });

    // Act
    const result = await observeReleaseCiForReleasePullRequest({
      releaseIntentId: RELEASE_INTENT_ID,
      target: "main",
      repository,
      observeGithubPullRequest,
      observeReleaseCiStatus: CI_SUCCEEDED_STATUS,
    });

    // Assert
    expect(result).toEqual({ outcome: "release_intent_invalid", releaseIntentId: RELEASE_INTENT_ID, target: "main" });
  });

  it("should fail closed with release_pull_request_missing when no PR result is persisted yet for this target", async () => {
    // Arrange
    const repository = fakeRepository({ ...validIntentDocument, pullRequests: {} });
    const observeGithubPullRequest = fakeObserveGithubPullRequest({ ok: true, pullRequest: RECONCILED_PULL_REQUEST });

    // Act
    const result = await observeReleaseCiForReleasePullRequest({
      releaseIntentId: RELEASE_INTENT_ID,
      target: "main",
      repository,
      observeGithubPullRequest,
      observeReleaseCiStatus: CI_SUCCEEDED_STATUS,
    });

    // Assert
    expect(result).toEqual({ outcome: "release_pull_request_missing", releaseIntentId: RELEASE_INTENT_ID, target: "main" });
    expect(observeGithubPullRequest).not.toHaveBeenCalled();
  });

  it("should fail closed with pull_request_observation_failed, never calling CI observation, when the fresh PR observation fails", async () => {
    // Arrange
    const repository = fakeRepository(validIntentDocument);
    const observeGithubPullRequest = fakeObserveGithubPullRequest({ ok: false, reason: "pull_request_lookup_failed", httpStatus: 404 });

    // Act
    const result = await observeReleaseCiForReleasePullRequest({
      releaseIntentId: RELEASE_INTENT_ID,
      target: "main",
      repository,
      observeGithubPullRequest,
      observeReleaseCiStatus: CI_SUCCEEDED_STATUS,
    });

    // Assert
    expect(result).toEqual({
      outcome: "pull_request_observation_failed",
      releaseIntentId: RELEASE_INTENT_ID,
      target: "main",
      number: MAIN_PR_NUMBER,
      reason: "pull_request_lookup_failed",
      httpStatus: 404,
    });
    expect(CI_SUCCEEDED_STATUS).not.toHaveBeenCalled();
  });

  it("should fail closed with pull_request_head_repository_mismatch, never calling CI observation, when the head repository is a fork", async () => {
    // Arrange
    const repository = fakeRepository(validIntentDocument);
    const observeGithubPullRequest = fakeObserveGithubPullRequest({
      ok: true,
      pullRequest: { ...RECONCILED_PULL_REQUEST, headRepositoryFullName: "someone-else/kanban-app" },
    });

    // Act
    const result = await observeReleaseCiForReleasePullRequest({
      releaseIntentId: RELEASE_INTENT_ID,
      target: "main",
      repository,
      observeGithubPullRequest,
      observeReleaseCiStatus: CI_SUCCEEDED_STATUS,
    });

    // Assert
    expect(result).toEqual({
      outcome: "pull_request_head_repository_mismatch",
      releaseIntentId: RELEASE_INTENT_ID,
      target: "main",
      number: MAIN_PR_NUMBER,
    });
    expect(CI_SUCCEEDED_STATUS).not.toHaveBeenCalled();
  });

  it("should fail closed with pull_request_repository_mismatch when the base repository disagrees", async () => {
    // Arrange
    const repository = fakeRepository(validIntentDocument);
    const observeGithubPullRequest = fakeObserveGithubPullRequest({
      ok: true,
      pullRequest: { ...RECONCILED_PULL_REQUEST, baseRepositoryFullName: "someone-else/kanban-app" },
    });

    // Act
    const result = await observeReleaseCiForReleasePullRequest({
      releaseIntentId: RELEASE_INTENT_ID,
      target: "main",
      repository,
      observeGithubPullRequest,
      observeReleaseCiStatus: CI_SUCCEEDED_STATUS,
    });

    // Assert
    expect(result).toEqual({
      outcome: "pull_request_repository_mismatch",
      releaseIntentId: RELEASE_INTENT_ID,
      target: "main",
      number: MAIN_PR_NUMBER,
    });
  });

  it("should fail closed with pull_request_head_branch_mismatch when the fresh head branch drifted", async () => {
    // Arrange
    const repository = fakeRepository(validIntentDocument);
    const observeGithubPullRequest = fakeObserveGithubPullRequest({
      ok: true,
      pullRequest: { ...RECONCILED_PULL_REQUEST, headRef: "release/0.1.2" },
    });

    // Act
    const result = await observeReleaseCiForReleasePullRequest({
      releaseIntentId: RELEASE_INTENT_ID,
      target: "main",
      repository,
      observeGithubPullRequest,
      observeReleaseCiStatus: CI_SUCCEEDED_STATUS,
    });

    // Assert
    expect(result).toEqual({
      outcome: "pull_request_head_branch_mismatch",
      releaseIntentId: RELEASE_INTENT_ID,
      target: "main",
      number: MAIN_PR_NUMBER,
    });
  });

  it("should fail closed with pull_request_head_sha_mismatch, never trusting CI, when the fresh head SHA has drifted", async () => {
    // Arrange
    const repository = fakeRepository(validIntentDocument);
    const observeGithubPullRequest = fakeObserveGithubPullRequest({
      ok: true,
      pullRequest: { ...RECONCILED_PULL_REQUEST, headSha: "d".repeat(40) },
    });

    // Act
    const result = await observeReleaseCiForReleasePullRequest({
      releaseIntentId: RELEASE_INTENT_ID,
      target: "main",
      repository,
      observeGithubPullRequest,
      observeReleaseCiStatus: CI_SUCCEEDED_STATUS,
    });

    // Assert
    expect(result).toEqual({
      outcome: "pull_request_head_sha_mismatch",
      releaseIntentId: RELEASE_INTENT_ID,
      target: "main",
      number: MAIN_PR_NUMBER,
    });
    expect(CI_SUCCEEDED_STATUS).not.toHaveBeenCalled();
  });

  it("should fail closed with pull_request_base_branch_mismatch when the persisted PR has been retargeted", async () => {
    // Arrange
    const repository = fakeRepository(validIntentDocument);
    const observeGithubPullRequest = fakeObserveGithubPullRequest({
      ok: true,
      pullRequest: { ...RECONCILED_PULL_REQUEST, baseRef: "develop" },
    });

    // Act
    const result = await observeReleaseCiForReleasePullRequest({
      releaseIntentId: RELEASE_INTENT_ID,
      target: "main",
      repository,
      observeGithubPullRequest,
      observeReleaseCiStatus: CI_SUCCEEDED_STATUS,
    });

    // Assert
    expect(result).toEqual({
      outcome: "pull_request_base_branch_mismatch",
      releaseIntentId: RELEASE_INTENT_ID,
      target: "main",
      number: MAIN_PR_NUMBER,
    });
  });

  it("should fail closed with pull_request_state_invalid when the persisted PR is no longer open", async () => {
    // Arrange
    const repository = fakeRepository(validIntentDocument);
    const observeGithubPullRequest = fakeObserveGithubPullRequest({
      ok: true,
      pullRequest: { ...RECONCILED_PULL_REQUEST, state: "closed" },
    });

    // Act
    const result = await observeReleaseCiForReleasePullRequest({
      releaseIntentId: RELEASE_INTENT_ID,
      target: "main",
      repository,
      observeGithubPullRequest,
      observeReleaseCiStatus: CI_SUCCEEDED_STATUS,
    });

    // Assert
    expect(result).toEqual({
      outcome: "pull_request_state_invalid",
      releaseIntentId: RELEASE_INTENT_ID,
      target: "main",
      number: MAIN_PR_NUMBER,
    });
  });

  it("should independently evaluate the develop target without any cross-contamination from main's persisted result", async () => {
    // Arrange
    const developIntent = {
      ...validIntentDocument,
      pullRequests: {
        ...validIntentDocument.pullRequests,
        develop: { number: 65, baseBranch: "develop", headBranch: RELEASE_BRANCH, headSha: RELEASE_COMMIT_SHA, recordedAt: Timestamp.fromMillis(0) },
      },
    };
    const repository = fakeRepository(developIntent);
    const observeGithubPullRequest = fakeObserveGithubPullRequest({
      ok: true,
      pullRequest: { ...RECONCILED_PULL_REQUEST, number: 65, baseRef: "develop" },
    });
    const observeReleaseCiStatus = fakeObserveReleaseCiStatus({
      ok: true,
      state: "succeeded",
      runId: 999,
      htmlUrl: "https://github.com/johnpwise/kanban-app/actions/runs/999",
    });

    // Act
    const result = await observeReleaseCiForReleasePullRequest({
      releaseIntentId: RELEASE_INTENT_ID,
      target: "develop",
      repository,
      observeGithubPullRequest,
      observeReleaseCiStatus,
    });

    // Assert
    expect(result).toEqual({
      outcome: "ci_succeeded",
      releaseIntentId: RELEASE_INTENT_ID,
      target: "develop",
      number: 65,
      runId: 999,
      htmlUrl: "https://github.com/johnpwise/kanban-app/actions/runs/999",
    });
    expect(observeReleaseCiStatus).toHaveBeenCalledWith({
      repository: REPOSITORY,
      expectedIdentity: { prNumber: 65, baseBranch: "develop", headBranch: RELEASE_BRANCH, headSha: RELEASE_COMMIT_SHA },
    });
  });
});
