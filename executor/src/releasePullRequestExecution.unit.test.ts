import { describe, expect, it } from "vitest";

import { buildReleasePullRequestTitle, executeEligibleReleasePullRequest } from "./releasePullRequestExecution";

import type { CreateOrReuseGithubPullRequest } from "./githubPullRequest";
import type { ObserveGithubPullRequest, ObservedPullRequest } from "./githubPullRequestObservation";
import type { ReleasePullRequestEligibilityOutcome } from "./releasePullRequestEligibility";

const RELEASE_INTENT_ID = "johnpwise__kanban-app--0.2.0";
const REPOSITORY = "johnpwise/kanban-app";
const VERSION = "0.2.0";
const SOURCE_BRANCH = "develop";
const SOURCE_REVISION = "a".repeat(40);
const RELEASE_BRANCH = "release/0.2.0";
const RELEASE_COMMIT_SHA = "c".repeat(40);
const OTHER_SHA = "d".repeat(40);

const ELIGIBLE_OUTCOME: Extract<ReleasePullRequestEligibilityOutcome, { eligible: true }> = {
  eligible: true,
  releaseIntentId: RELEASE_INTENT_ID,
  repository: REPOSITORY,
  version: VERSION,
  sourceBranch: SOURCE_BRANCH,
  sourceRevision: SOURCE_REVISION,
  releaseBranch: RELEASE_BRANCH,
  releaseCommitSha: RELEASE_COMMIT_SHA,
  mainBranch: "main",
  developBranch: "develop",
};

const NOT_ELIGIBLE_OUTCOME: ReleasePullRequestEligibilityOutcome = { eligible: false, reason: "release_start_missing" };

function fakeEvaluateEligibility(outcome: ReleasePullRequestEligibilityOutcome) {
  return async () => outcome;
}

function fakeCreateOrReuse(
  behavior:
    | { ok: true; status: "created" | "existing"; number: number; htmlUrl?: string }
    | { ok: false; reason: "credential_unavailable"; credentialReason?: string; httpStatus?: number }
    | { ok: false; reason: "lookup_failed" | "create_failed"; httpStatus: number }
    | { ok: false; reason: "lookup_network_error" | "create_network_error" },
): { createOrReuseGithubPullRequest: CreateOrReuseGithubPullRequest; calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    createOrReuseGithubPullRequest: async (request) => {
      calls.push(request);
      if (behavior.ok) {
        return { ok: true, status: behavior.status, number: behavior.number, htmlUrl: behavior.htmlUrl ?? "https://github.com/johnpwise/kanban-app/pull/1" };
      }
      return behavior as never;
    },
  };
}

function observedPullRequest(overrides: Partial<ObservedPullRequest> = {}): ObservedPullRequest {
  return {
    number: 101,
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
    ...overrides,
  };
}

function fakeObserve(pullRequest: ObservedPullRequest | { ok: false; reason: string; httpStatus?: number }): ObserveGithubPullRequest {
  return async () => {
    if ("ok" in pullRequest) {
      return pullRequest as never;
    }
    return { ok: true, pullRequest };
  };
}

describe("buildReleasePullRequestTitle", () => {
  it("builds a deterministic title for the main target", () => {
    expect(buildReleasePullRequestTitle(VERSION, "main")).toBe("Release 0.2.0 → main");
  });

  it("builds a deterministic title for the develop target", () => {
    expect(buildReleasePullRequestTitle(VERSION, "develop")).toBe("Release 0.2.0 → develop");
  });
});

describe("executeEligibleReleasePullRequest", () => {
  it("verifies a freshly created pull request for the main target", async () => {
    // Arrange
    const { createOrReuseGithubPullRequest, calls } = fakeCreateOrReuse({ ok: true, status: "created", number: 101 });
    const observeGithubPullRequest = fakeObserve(observedPullRequest({ baseRef: "main" }));

    // Act
    const result = await executeEligibleReleasePullRequest({
      releaseIntentId: RELEASE_INTENT_ID,
      target: "main",
      evaluateReleasePullRequestEligibility: fakeEvaluateEligibility(ELIGIBLE_OUTCOME),
      createOrReuseGithubPullRequest,
      observeGithubPullRequest,
    });

    // Assert
    expect(result).toEqual({
      outcome: "verified",
      releaseIntentId: RELEASE_INTENT_ID,
      repository: REPOSITORY,
      version: VERSION,
      sourceBranch: SOURCE_BRANCH,
      sourceRevision: SOURCE_REVISION,
      target: "main",
      releaseBranch: RELEASE_BRANCH,
      releaseCommitSha: RELEASE_COMMIT_SHA,
      number: 101,
    });
    const createRequest = calls[0] as { repository: string; head: string; base: string; title: string; body: string };
    expect(createRequest.repository).toBe(REPOSITORY);
    expect(createRequest.head).toBe(RELEASE_BRANCH);
    expect(createRequest.base).toBe("main");
    expect(createRequest.title).toBe("Release 0.2.0 → main");
    expect(createRequest.body).toContain(RELEASE_INTENT_ID);
    expect(createRequest.body).toContain(VERSION);
    expect(createRequest.body).toContain(RELEASE_BRANCH);
    expect(createRequest.body).toContain(RELEASE_COMMIT_SHA);
    expect(createRequest.body).toContain(SOURCE_REVISION);
    expect(createRequest.body).toContain("main");
  });

  it("verifies a freshly reused pull request for the develop target", async () => {
    // Arrange
    const { createOrReuseGithubPullRequest, calls } = fakeCreateOrReuse({ ok: true, status: "existing", number: 202 });
    const observeGithubPullRequest = fakeObserve(observedPullRequest({ number: 202, baseRef: "develop" }));

    // Act
    const result = await executeEligibleReleasePullRequest({
      releaseIntentId: RELEASE_INTENT_ID,
      target: "develop",
      evaluateReleasePullRequestEligibility: fakeEvaluateEligibility(ELIGIBLE_OUTCOME),
      createOrReuseGithubPullRequest,
      observeGithubPullRequest,
    });

    // Assert
    expect(result).toEqual({
      outcome: "verified",
      releaseIntentId: RELEASE_INTENT_ID,
      repository: REPOSITORY,
      version: VERSION,
      sourceBranch: SOURCE_BRANCH,
      sourceRevision: SOURCE_REVISION,
      target: "develop",
      releaseBranch: RELEASE_BRANCH,
      releaseCommitSha: RELEASE_COMMIT_SHA,
      number: 202,
    });
    const createRequest = calls[0] as { base: string; title: string };
    expect(createRequest.base).toBe("develop");
    expect(createRequest.title).toBe("Release 0.2.0 → develop");
  });

  it("performs no GitHub mutation when not eligible", async () => {
    // Arrange
    const { createOrReuseGithubPullRequest, calls } = fakeCreateOrReuse({ ok: true, status: "created", number: 101 });
    const observeGithubPullRequest = fakeObserve(observedPullRequest());

    // Act
    const result = await executeEligibleReleasePullRequest({
      releaseIntentId: RELEASE_INTENT_ID,
      target: "main",
      evaluateReleasePullRequestEligibility: fakeEvaluateEligibility(NOT_ELIGIBLE_OUTCOME),
      createOrReuseGithubPullRequest,
      observeGithubPullRequest,
    });

    // Assert
    expect(result).toEqual({ outcome: "not_eligible", releaseIntentId: RELEASE_INTENT_ID, target: "main", eligibility: NOT_ELIGIBLE_OUTCOME });
    expect(calls).toHaveLength(0);
  });

  it("returns create_or_reuse_failed, passing through the failure reason, when create/reuse fails", async () => {
    // Arrange
    const { createOrReuseGithubPullRequest } = fakeCreateOrReuse({ ok: false, reason: "create_failed", httpStatus: 422 });
    const observeGithubPullRequest = fakeObserve(observedPullRequest());

    // Act
    const result = await executeEligibleReleasePullRequest({
      releaseIntentId: RELEASE_INTENT_ID,
      target: "main",
      evaluateReleasePullRequestEligibility: fakeEvaluateEligibility(ELIGIBLE_OUTCOME),
      createOrReuseGithubPullRequest,
      observeGithubPullRequest,
    });

    // Assert
    expect(result).toEqual({
      outcome: "create_or_reuse_failed",
      releaseIntentId: RELEASE_INTENT_ID,
      repository: REPOSITORY,
      target: "main",
      reason: "create_failed",
      httpStatus: 422,
    });
  });

  it("returns verification_observation_failed when the fresh re-fetch fails", async () => {
    // Arrange
    const { createOrReuseGithubPullRequest } = fakeCreateOrReuse({ ok: true, status: "created", number: 101 });
    const observeGithubPullRequest = fakeObserve({ ok: false, reason: "pull_request_lookup_failed", httpStatus: 404 });

    // Act
    const result = await executeEligibleReleasePullRequest({
      releaseIntentId: RELEASE_INTENT_ID,
      target: "main",
      evaluateReleasePullRequestEligibility: fakeEvaluateEligibility(ELIGIBLE_OUTCOME),
      createOrReuseGithubPullRequest,
      observeGithubPullRequest,
    });

    // Assert
    expect(result).toEqual({
      outcome: "verification_observation_failed",
      releaseIntentId: RELEASE_INTENT_ID,
      repository: REPOSITORY,
      target: "main",
      number: 101,
      reason: "pull_request_lookup_failed",
      httpStatus: 404,
    });
  });

  it("fails closed with verification_base_repository_mismatch when the base repository is not the trusted repository", async () => {
    // Arrange
    const { createOrReuseGithubPullRequest } = fakeCreateOrReuse({ ok: true, status: "created", number: 101 });
    const observeGithubPullRequest = fakeObserve(observedPullRequest({ baseRepositoryFullName: "someone-else/fork" }));

    // Act
    const result = await executeEligibleReleasePullRequest({
      releaseIntentId: RELEASE_INTENT_ID,
      target: "main",
      evaluateReleasePullRequestEligibility: fakeEvaluateEligibility(ELIGIBLE_OUTCOME),
      createOrReuseGithubPullRequest,
      observeGithubPullRequest,
    });

    // Assert
    expect(result).toEqual({
      outcome: "verification_base_repository_mismatch",
      releaseIntentId: RELEASE_INTENT_ID,
      repository: REPOSITORY,
      target: "main",
      number: 101,
    });
  });

  it("fails closed with verification_head_repository_mismatch when the head repository is not the trusted repository (e.g. a fork)", async () => {
    // Arrange
    const { createOrReuseGithubPullRequest } = fakeCreateOrReuse({ ok: true, status: "created", number: 101 });
    const observeGithubPullRequest = fakeObserve(observedPullRequest({ headRepositoryFullName: "someone-else/fork" }));

    // Act
    const result = await executeEligibleReleasePullRequest({
      releaseIntentId: RELEASE_INTENT_ID,
      target: "main",
      evaluateReleasePullRequestEligibility: fakeEvaluateEligibility(ELIGIBLE_OUTCOME),
      createOrReuseGithubPullRequest,
      observeGithubPullRequest,
    });

    // Assert
    expect(result).toEqual({
      outcome: "verification_head_repository_mismatch",
      releaseIntentId: RELEASE_INTENT_ID,
      repository: REPOSITORY,
      target: "main",
      number: 101,
    });
  });

  it("fails closed with verification_head_ref_mismatch when the observed head ref is not the trusted release branch", async () => {
    // Arrange
    const { createOrReuseGithubPullRequest } = fakeCreateOrReuse({ ok: true, status: "created", number: 101 });
    const observeGithubPullRequest = fakeObserve(observedPullRequest({ headRef: "some-other-branch" }));

    // Act
    const result = await executeEligibleReleasePullRequest({
      releaseIntentId: RELEASE_INTENT_ID,
      target: "main",
      evaluateReleasePullRequestEligibility: fakeEvaluateEligibility(ELIGIBLE_OUTCOME),
      createOrReuseGithubPullRequest,
      observeGithubPullRequest,
    });

    // Assert
    expect(result).toEqual({
      outcome: "verification_head_ref_mismatch",
      releaseIntentId: RELEASE_INTENT_ID,
      repository: REPOSITORY,
      target: "main",
      number: 101,
      expectedHeadRef: RELEASE_BRANCH,
      actualHeadRef: "some-other-branch",
    });
  });

  it("fails closed with verification_head_sha_mismatch when the observed head SHA is not the trusted persisted start commit", async () => {
    // Arrange
    const { createOrReuseGithubPullRequest } = fakeCreateOrReuse({ ok: true, status: "created", number: 101 });
    const observeGithubPullRequest = fakeObserve(observedPullRequest({ headSha: OTHER_SHA }));

    // Act
    const result = await executeEligibleReleasePullRequest({
      releaseIntentId: RELEASE_INTENT_ID,
      target: "main",
      evaluateReleasePullRequestEligibility: fakeEvaluateEligibility(ELIGIBLE_OUTCOME),
      createOrReuseGithubPullRequest,
      observeGithubPullRequest,
    });

    // Assert
    expect(result).toEqual({
      outcome: "verification_head_sha_mismatch",
      releaseIntentId: RELEASE_INTENT_ID,
      repository: REPOSITORY,
      target: "main",
      number: 101,
      expectedHeadSha: RELEASE_COMMIT_SHA,
      actualHeadSha: OTHER_SHA,
    });
  });

  it("fails closed with verification_base_ref_mismatch when the observed base ref is not the requested target", async () => {
    // Arrange
    const { createOrReuseGithubPullRequest } = fakeCreateOrReuse({ ok: true, status: "created", number: 101 });
    const observeGithubPullRequest = fakeObserve(observedPullRequest({ baseRef: "develop" }));

    // Act
    const result = await executeEligibleReleasePullRequest({
      releaseIntentId: RELEASE_INTENT_ID,
      target: "main",
      evaluateReleasePullRequestEligibility: fakeEvaluateEligibility(ELIGIBLE_OUTCOME),
      createOrReuseGithubPullRequest,
      observeGithubPullRequest,
    });

    // Assert
    expect(result).toEqual({
      outcome: "verification_base_ref_mismatch",
      releaseIntentId: RELEASE_INTENT_ID,
      repository: REPOSITORY,
      target: "main",
      number: 101,
      expectedBaseRef: "main",
      actualBaseRef: "develop",
    });
  });

  it("fails closed with verification_state_invalid when the observed pull request is already closed", async () => {
    // Arrange
    const { createOrReuseGithubPullRequest } = fakeCreateOrReuse({ ok: true, status: "existing", number: 101 });
    const observeGithubPullRequest = fakeObserve(observedPullRequest({ state: "closed" }));

    // Act
    const result = await executeEligibleReleasePullRequest({
      releaseIntentId: RELEASE_INTENT_ID,
      target: "main",
      evaluateReleasePullRequestEligibility: fakeEvaluateEligibility(ELIGIBLE_OUTCOME),
      createOrReuseGithubPullRequest,
      observeGithubPullRequest,
    });

    // Assert
    expect(result).toEqual({
      outcome: "verification_state_invalid",
      releaseIntentId: RELEASE_INTENT_ID,
      repository: REPOSITORY,
      target: "main",
      number: 101,
    });
  });

  it("fails closed with verification_state_invalid when the observed pull request is already merged", async () => {
    // Arrange
    const { createOrReuseGithubPullRequest } = fakeCreateOrReuse({ ok: true, status: "existing", number: 101 });
    const observeGithubPullRequest = fakeObserve(observedPullRequest({ state: "closed", merged: true }));

    // Act
    const result = await executeEligibleReleasePullRequest({
      releaseIntentId: RELEASE_INTENT_ID,
      target: "main",
      evaluateReleasePullRequestEligibility: fakeEvaluateEligibility(ELIGIBLE_OUTCOME),
      createOrReuseGithubPullRequest,
      observeGithubPullRequest,
    });

    // Assert
    expect(result).toEqual({
      outcome: "verification_state_invalid",
      releaseIntentId: RELEASE_INTENT_ID,
      repository: REPOSITORY,
      target: "main",
      number: 101,
    });
  });
});
