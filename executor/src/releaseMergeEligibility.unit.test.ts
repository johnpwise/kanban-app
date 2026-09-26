import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";

import { evaluateReleaseMergeEligibility } from "./releaseMergeEligibility";
import { createFakeReleaseIntentRepository } from "./testHelpers/fakeReleaseIntentRepository";

import type { ObserveGithubPullRequest, ObservedPullRequest, ObserveGithubPullRequestOutcome } from "./githubPullRequestObservation";

const REPOSITORY = "johnpwise/kanban-app";
const RELEASE_INTENT_ID = "johnpwise__kanban-app--0.2.0";
const VERSION = "0.2.0";
const SOURCE_BRANCH = "develop";
const SOURCE_REVISION = "a".repeat(40);
const RELEASE_BRANCH = "release/0.2.0";
const RELEASE_COMMIT_SHA = "c".repeat(40);
const OTHER_COMMIT_SHA = "d".repeat(40);
const MAIN_PR_NUMBER = 64;
const DEVELOP_PR_NUMBER = 65;
const MAIN_RUN_ID = 501;
const DEVELOP_RUN_ID = 502;

function pullRequestResult(overrides: Record<string, unknown> = {}) {
  return {
    number: MAIN_PR_NUMBER,
    baseBranch: "main",
    headBranch: RELEASE_BRANCH,
    headSha: RELEASE_COMMIT_SHA,
    recordedAt: Timestamp.fromMillis(0),
    ...overrides,
  };
}

function ciResult(overrides: Record<string, unknown> = {}) {
  return {
    number: MAIN_PR_NUMBER,
    baseBranch: "main",
    headBranch: RELEASE_BRANCH,
    headSha: RELEASE_COMMIT_SHA,
    state: "succeeded" as const,
    runId: MAIN_RUN_ID,
    htmlUrl: `https://github.com/${REPOSITORY}/actions/runs/${MAIN_RUN_ID}`,
    recordedAt: Timestamp.fromMillis(0),
    ...overrides,
  };
}

function validIntentDocument(overrides: Record<string, unknown> = {}) {
  return {
    releaseIntentId: RELEASE_INTENT_ID,
    repository: REPOSITORY,
    version: VERSION,
    sourceBranch: SOURCE_BRANCH,
    sourceRevision: SOURCE_REVISION,
    requestedAt: Timestamp.fromMillis(0),
    start: { releaseBranch: RELEASE_BRANCH, commitSha: RELEASE_COMMIT_SHA, recordedAt: Timestamp.fromMillis(0) },
    pullRequests: {
      main: pullRequestResult({ number: MAIN_PR_NUMBER, baseBranch: "main" }),
      develop: pullRequestResult({ number: DEVELOP_PR_NUMBER, baseBranch: "develop" }),
    },
    ci: {
      main: ciResult({ number: MAIN_PR_NUMBER, baseBranch: "main", runId: MAIN_RUN_ID }),
      develop: ciResult({
        number: DEVELOP_PR_NUMBER,
        baseBranch: "develop",
        runId: DEVELOP_RUN_ID,
        htmlUrl: `https://github.com/${REPOSITORY}/actions/runs/${DEVELOP_RUN_ID}`,
      }),
    },
    ...overrides,
  };
}

function observedPullRequest(overrides: Partial<ObservedPullRequest> = {}): ObservedPullRequest {
  return {
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
    ...overrides,
  };
}

/** Looks up a canned outcome by PR number — `target === "develop"` evaluations call this twice
 * (once for the `main` ordering prerequisite, once for `develop` itself), so call order alone can't
 * disambiguate. */
function fakeObserveByNumber(byNumber: Record<number, ObserveGithubPullRequestOutcome | Error>): {
  observeGithubPullRequest: ObserveGithubPullRequest;
  calls: { repository: string; pullRequestNumber: number }[];
} {
  const calls: { repository: string; pullRequestNumber: number }[] = [];
  return {
    calls,
    observeGithubPullRequest: (async (request) => {
      calls.push(request);
      const outcome = byNumber[request.pullRequestNumber];
      if (outcome === undefined) {
        throw new Error(`unexpected observation for PR #${request.pullRequestNumber}`);
      }
      if (outcome instanceof Error) {
        throw outcome;
      }
      return outcome;
    }) as ObserveGithubPullRequest,
  };
}

const MAIN_ALREADY_MERGED: ObserveGithubPullRequestOutcome = {
  ok: true,
  pullRequest: observedPullRequest({
    number: MAIN_PR_NUMBER,
    state: "closed",
    merged: true,
    baseRef: "main",
    mergeCommitSha: "e".repeat(40),
  }),
};

const DEVELOP_OPEN_MERGEABLE: ObserveGithubPullRequestOutcome = {
  ok: true,
  pullRequest: observedPullRequest({ number: DEVELOP_PR_NUMBER, baseRef: "develop" }),
};

describe("evaluateReleaseMergeEligibility", () => {
  describe("target: main — durable evidence failures (fail closed before any GitHub call)", () => {
    it("returns release_intent_load_error when loading the intent throws", async () => {
      const { repository } = createFakeReleaseIntentRepository({ throwError: new Error("firestore down") });
      const { observeGithubPullRequest, calls } = fakeObserveByNumber({});

      const result = await evaluateReleaseMergeEligibility({
        releaseIntentId: RELEASE_INTENT_ID,
        target: "main",
        repository,
        observeGithubPullRequest,
      });

      expect(result).toEqual({ eligible: false, reason: "release_intent_load_error" });
      expect(calls).toHaveLength(0);
    });

    it("returns release_intent_not_found when no such document exists", async () => {
      const { repository } = createFakeReleaseIntentRepository({ data: undefined });
      const { observeGithubPullRequest, calls } = fakeObserveByNumber({});

      const result = await evaluateReleaseMergeEligibility({
        releaseIntentId: RELEASE_INTENT_ID,
        target: "main",
        repository,
        observeGithubPullRequest,
      });

      expect(result).toEqual({ eligible: false, reason: "release_intent_not_found" });
      expect(calls).toHaveLength(0);
    });

    it("returns release_intent_invalid when the document fails schema validation", async () => {
      const { repository } = createFakeReleaseIntentRepository({ data: { releaseIntentId: RELEASE_INTENT_ID } });
      const { observeGithubPullRequest, calls } = fakeObserveByNumber({});

      const result = await evaluateReleaseMergeEligibility({
        releaseIntentId: RELEASE_INTENT_ID,
        target: "main",
        repository,
        observeGithubPullRequest,
      });

      expect(result).toEqual({ eligible: false, reason: "release_intent_invalid" });
      expect(calls).toHaveLength(0);
    });

    it("returns release_start_missing when the release intent has no durable start result", async () => {
      const { start: _start, ...withoutStart } = validIntentDocument();
      void _start;
      const { repository } = createFakeReleaseIntentRepository({ data: withoutStart });
      const { observeGithubPullRequest, calls } = fakeObserveByNumber({});

      const result = await evaluateReleaseMergeEligibility({
        releaseIntentId: RELEASE_INTENT_ID,
        target: "main",
        repository,
        observeGithubPullRequest,
      });

      expect(result).toEqual({ eligible: false, reason: "release_start_missing" });
      expect(calls).toHaveLength(0);
    });

    it("returns pull_request_missing (evidenceTarget: main) when the main PR identity is missing", async () => {
      const intent = validIntentDocument();
      delete (intent.pullRequests as Record<string, unknown>).main;
      const { repository } = createFakeReleaseIntentRepository({ data: intent });
      const { observeGithubPullRequest, calls } = fakeObserveByNumber({});

      const result = await evaluateReleaseMergeEligibility({
        releaseIntentId: RELEASE_INTENT_ID,
        target: "main",
        repository,
        observeGithubPullRequest,
      });

      expect(result).toEqual({ eligible: false, reason: "pull_request_missing", evidenceTarget: "main" });
      expect(calls).toHaveLength(0);
    });

    it("returns pull_request_missing (evidenceTarget: develop) when only the develop PR identity is missing", async () => {
      const intent = validIntentDocument();
      delete (intent.pullRequests as Record<string, unknown>).develop;
      const { repository } = createFakeReleaseIntentRepository({ data: intent });
      const { observeGithubPullRequest, calls } = fakeObserveByNumber({});

      const result = await evaluateReleaseMergeEligibility({
        releaseIntentId: RELEASE_INTENT_ID,
        target: "main",
        repository,
        observeGithubPullRequest,
      });

      expect(result).toEqual({ eligible: false, reason: "pull_request_missing", evidenceTarget: "develop" });
      expect(calls).toHaveLength(0);
    });

    it("returns ci_missing (evidenceTarget: main) when main CI evidence is missing", async () => {
      const intent = validIntentDocument();
      delete (intent.ci as Record<string, unknown>).main;
      const { repository } = createFakeReleaseIntentRepository({ data: intent });
      const { observeGithubPullRequest, calls } = fakeObserveByNumber({});

      const result = await evaluateReleaseMergeEligibility({
        releaseIntentId: RELEASE_INTENT_ID,
        target: "main",
        repository,
        observeGithubPullRequest,
      });

      expect(result).toEqual({ eligible: false, reason: "ci_missing", evidenceTarget: "main" });
      expect(calls).toHaveLength(0);
    });

    it("returns ci_missing (evidenceTarget: develop) when develop CI evidence is missing", async () => {
      const intent = validIntentDocument();
      delete (intent.ci as Record<string, unknown>).develop;
      const { repository } = createFakeReleaseIntentRepository({ data: intent });
      const { observeGithubPullRequest, calls } = fakeObserveByNumber({});

      const result = await evaluateReleaseMergeEligibility({
        releaseIntentId: RELEASE_INTENT_ID,
        target: "main",
        repository,
        observeGithubPullRequest,
      });

      expect(result).toEqual({ eligible: false, reason: "ci_missing", evidenceTarget: "develop" });
      expect(calls).toHaveLength(0);
    });

    it("returns ci_not_succeeded (evidenceTarget: main) when main CI failed", async () => {
      const intent = validIntentDocument({
        ci: {
          main: ciResult({ number: MAIN_PR_NUMBER, baseBranch: "main", state: "failed", conclusion: "failure" }),
          develop: ciResult({ number: DEVELOP_PR_NUMBER, baseBranch: "develop", runId: DEVELOP_RUN_ID }),
        },
      });
      const { repository } = createFakeReleaseIntentRepository({ data: intent });
      const { observeGithubPullRequest, calls } = fakeObserveByNumber({});

      const result = await evaluateReleaseMergeEligibility({
        releaseIntentId: RELEASE_INTENT_ID,
        target: "main",
        repository,
        observeGithubPullRequest,
      });

      expect(result).toEqual({ eligible: false, reason: "ci_not_succeeded", evidenceTarget: "main" });
      expect(calls).toHaveLength(0);
    });

    it("returns ci_not_succeeded (evidenceTarget: develop) when develop CI failed even though main succeeded", async () => {
      const intent = validIntentDocument({
        ci: {
          main: ciResult({ number: MAIN_PR_NUMBER, baseBranch: "main" }),
          develop: ciResult({ number: DEVELOP_PR_NUMBER, baseBranch: "develop", runId: DEVELOP_RUN_ID, state: "failed", conclusion: "failure" }),
        },
      });
      const { repository } = createFakeReleaseIntentRepository({ data: intent });
      const { observeGithubPullRequest, calls } = fakeObserveByNumber({});

      const result = await evaluateReleaseMergeEligibility({
        releaseIntentId: RELEASE_INTENT_ID,
        target: "main",
        repository,
        observeGithubPullRequest,
      });

      expect(result).toEqual({ eligible: false, reason: "ci_not_succeeded", evidenceTarget: "develop" });
      expect(calls).toHaveLength(0);
    });

    it("returns pull_request_base_branch_invalid when the durable main PR's base branch is not main", async () => {
      const intent = validIntentDocument({
        pullRequests: {
          main: pullRequestResult({ number: MAIN_PR_NUMBER, baseBranch: "develop" }),
          develop: pullRequestResult({ number: DEVELOP_PR_NUMBER, baseBranch: "develop" }),
        },
      });
      const { repository } = createFakeReleaseIntentRepository({ data: intent });
      const { observeGithubPullRequest, calls } = fakeObserveByNumber({});

      const result = await evaluateReleaseMergeEligibility({
        releaseIntentId: RELEASE_INTENT_ID,
        target: "main",
        repository,
        observeGithubPullRequest,
      });

      expect(result).toEqual({ eligible: false, reason: "pull_request_base_branch_invalid", evidenceTarget: "main" });
      expect(calls).toHaveLength(0);
    });

    it("returns ci_pull_request_number_mismatch when CI's number disagrees with the durable PR's number", async () => {
      const intent = validIntentDocument({
        ci: {
          main: ciResult({ number: 999, baseBranch: "main" }),
          develop: ciResult({ number: DEVELOP_PR_NUMBER, baseBranch: "develop", runId: DEVELOP_RUN_ID }),
        },
      });
      const { repository } = createFakeReleaseIntentRepository({ data: intent });
      const { observeGithubPullRequest, calls } = fakeObserveByNumber({});

      const result = await evaluateReleaseMergeEligibility({
        releaseIntentId: RELEASE_INTENT_ID,
        target: "main",
        repository,
        observeGithubPullRequest,
      });

      expect(result).toEqual({ eligible: false, reason: "ci_pull_request_number_mismatch", evidenceTarget: "main" });
      expect(calls).toHaveLength(0);
    });

    it("returns ci_pull_request_base_branch_mismatch when CI's base branch disagrees with the durable PR's", async () => {
      const intent = validIntentDocument({
        ci: {
          main: ciResult({ number: MAIN_PR_NUMBER, baseBranch: "develop" }),
          develop: ciResult({ number: DEVELOP_PR_NUMBER, baseBranch: "develop", runId: DEVELOP_RUN_ID }),
        },
      });
      const { repository } = createFakeReleaseIntentRepository({ data: intent });
      const { observeGithubPullRequest, calls } = fakeObserveByNumber({});

      const result = await evaluateReleaseMergeEligibility({
        releaseIntentId: RELEASE_INTENT_ID,
        target: "main",
        repository,
        observeGithubPullRequest,
      });

      expect(result).toEqual({ eligible: false, reason: "ci_pull_request_base_branch_mismatch", evidenceTarget: "main" });
      expect(calls).toHaveLength(0);
    });

    it("returns ci_pull_request_head_branch_mismatch when CI's head branch disagrees with the durable PR's", async () => {
      const intent = validIntentDocument({
        ci: {
          main: ciResult({ number: MAIN_PR_NUMBER, baseBranch: "main", headBranch: "some-other-branch" }),
          develop: ciResult({ number: DEVELOP_PR_NUMBER, baseBranch: "develop", runId: DEVELOP_RUN_ID }),
        },
      });
      const { repository } = createFakeReleaseIntentRepository({ data: intent });
      const { observeGithubPullRequest, calls } = fakeObserveByNumber({});

      const result = await evaluateReleaseMergeEligibility({
        releaseIntentId: RELEASE_INTENT_ID,
        target: "main",
        repository,
        observeGithubPullRequest,
      });

      expect(result).toEqual({ eligible: false, reason: "ci_pull_request_head_branch_mismatch", evidenceTarget: "main" });
      expect(calls).toHaveLength(0);
    });

    it("returns ci_pull_request_head_sha_mismatch when CI's head SHA disagrees with the durable PR's", async () => {
      const intent = validIntentDocument({
        ci: {
          main: ciResult({ number: MAIN_PR_NUMBER, baseBranch: "main", headSha: OTHER_COMMIT_SHA }),
          develop: ciResult({ number: DEVELOP_PR_NUMBER, baseBranch: "develop", runId: DEVELOP_RUN_ID }),
        },
      });
      const { repository } = createFakeReleaseIntentRepository({ data: intent });
      const { observeGithubPullRequest, calls } = fakeObserveByNumber({});

      const result = await evaluateReleaseMergeEligibility({
        releaseIntentId: RELEASE_INTENT_ID,
        target: "main",
        repository,
        observeGithubPullRequest,
      });

      expect(result).toEqual({ eligible: false, reason: "ci_pull_request_head_sha_mismatch", evidenceTarget: "main" });
      expect(calls).toHaveLength(0);
    });

    it("returns pull_request_start_head_branch_mismatch when the durable PR head branch disagrees with release-start", async () => {
      const intent = validIntentDocument({
        pullRequests: {
          main: pullRequestResult({ number: MAIN_PR_NUMBER, baseBranch: "main", headBranch: "release/0.9.9" }),
          develop: pullRequestResult({ number: DEVELOP_PR_NUMBER, baseBranch: "develop" }),
        },
        ci: {
          main: ciResult({ number: MAIN_PR_NUMBER, baseBranch: "main", headBranch: "release/0.9.9" }),
          develop: ciResult({ number: DEVELOP_PR_NUMBER, baseBranch: "develop", runId: DEVELOP_RUN_ID }),
        },
      });
      const { repository } = createFakeReleaseIntentRepository({ data: intent });
      const { observeGithubPullRequest, calls } = fakeObserveByNumber({});

      const result = await evaluateReleaseMergeEligibility({
        releaseIntentId: RELEASE_INTENT_ID,
        target: "main",
        repository,
        observeGithubPullRequest,
      });

      expect(result).toEqual({ eligible: false, reason: "pull_request_start_head_branch_mismatch", evidenceTarget: "main" });
      expect(calls).toHaveLength(0);
    });

    it("returns pull_request_start_head_sha_mismatch when the durable PR head SHA disagrees with release-start", async () => {
      const intent = validIntentDocument({
        pullRequests: {
          main: pullRequestResult({ number: MAIN_PR_NUMBER, baseBranch: "main", headSha: OTHER_COMMIT_SHA }),
          develop: pullRequestResult({ number: DEVELOP_PR_NUMBER, baseBranch: "develop" }),
        },
        ci: {
          main: ciResult({ number: MAIN_PR_NUMBER, baseBranch: "main", headSha: OTHER_COMMIT_SHA }),
          develop: ciResult({ number: DEVELOP_PR_NUMBER, baseBranch: "develop", runId: DEVELOP_RUN_ID }),
        },
      });
      const { repository } = createFakeReleaseIntentRepository({ data: intent });
      const { observeGithubPullRequest, calls } = fakeObserveByNumber({});

      const result = await evaluateReleaseMergeEligibility({
        releaseIntentId: RELEASE_INTENT_ID,
        target: "main",
        repository,
        observeGithubPullRequest,
      });

      expect(result).toEqual({ eligible: false, reason: "pull_request_start_head_sha_mismatch", evidenceTarget: "main" });
      expect(calls).toHaveLength(0);
    });
  });

  describe("target: main — fresh GitHub reconciliation", () => {
    it("is eligible when the live main PR is open, not draft, identity-exact, and mergeable", async () => {
      const { repository } = createFakeReleaseIntentRepository({ data: validIntentDocument() });
      const { observeGithubPullRequest, calls } = fakeObserveByNumber({
        [MAIN_PR_NUMBER]: { ok: true, pullRequest: observedPullRequest({ number: MAIN_PR_NUMBER, baseRef: "main" }) },
      });

      const result = await evaluateReleaseMergeEligibility({
        releaseIntentId: RELEASE_INTENT_ID,
        target: "main",
        repository,
        observeGithubPullRequest,
      });

      expect(result).toEqual({
        eligible: true,
        releaseIntentId: RELEASE_INTENT_ID,
        target: "main",
        repository: REPOSITORY,
        pullRequestNumber: MAIN_PR_NUMBER,
        headSha: RELEASE_COMMIT_SHA,
      });
      expect(calls).toEqual([{ repository: REPOSITORY, pullRequestNumber: MAIN_PR_NUMBER }]);
    });

    it("returns pull_request_observation_error when observation throws unexpectedly", async () => {
      const { repository } = createFakeReleaseIntentRepository({ data: validIntentDocument() });
      const { observeGithubPullRequest } = fakeObserveByNumber({ [MAIN_PR_NUMBER]: new Error("network down") });

      const result = await evaluateReleaseMergeEligibility({
        releaseIntentId: RELEASE_INTENT_ID,
        target: "main",
        repository,
        observeGithubPullRequest,
      });

      expect(result).toEqual({ eligible: false, reason: "pull_request_observation_error", target: "main", pullRequestNumber: MAIN_PR_NUMBER });
    });

    it("passes through a credential_unavailable observation failure", async () => {
      const { repository } = createFakeReleaseIntentRepository({ data: validIntentDocument() });
      const { observeGithubPullRequest } = fakeObserveByNumber({
        [MAIN_PR_NUMBER]: { ok: false, reason: "credential_unavailable", credentialReason: "installation_not_found" },
      });

      const result = await evaluateReleaseMergeEligibility({
        releaseIntentId: RELEASE_INTENT_ID,
        target: "main",
        repository,
        observeGithubPullRequest,
      });

      expect(result).toEqual({
        eligible: false,
        target: "main",
        pullRequestNumber: MAIN_PR_NUMBER,
        reason: "credential_unavailable",
        credentialReason: "installation_not_found",
      });
    });

    it("returns pull_request_repository_mismatch when the live base repository differs", async () => {
      const { repository } = createFakeReleaseIntentRepository({ data: validIntentDocument() });
      const { observeGithubPullRequest } = fakeObserveByNumber({
        [MAIN_PR_NUMBER]: { ok: true, pullRequest: observedPullRequest({ number: MAIN_PR_NUMBER, baseRef: "main", baseRepositoryFullName: "someone/fork" }) },
      });

      const result = await evaluateReleaseMergeEligibility({
        releaseIntentId: RELEASE_INTENT_ID,
        target: "main",
        repository,
        observeGithubPullRequest,
      });

      expect(result).toEqual({ eligible: false, reason: "pull_request_repository_mismatch", target: "main", pullRequestNumber: MAIN_PR_NUMBER });
    });

    it("returns pull_request_head_repository_mismatch when the live head repository differs (a fork)", async () => {
      const { repository } = createFakeReleaseIntentRepository({ data: validIntentDocument() });
      const { observeGithubPullRequest } = fakeObserveByNumber({
        [MAIN_PR_NUMBER]: {
          ok: true,
          pullRequest: observedPullRequest({ number: MAIN_PR_NUMBER, baseRef: "main", headRepositoryFullName: "someone/fork" }),
        },
      });

      const result = await evaluateReleaseMergeEligibility({
        releaseIntentId: RELEASE_INTENT_ID,
        target: "main",
        repository,
        observeGithubPullRequest,
      });

      expect(result).toEqual({ eligible: false, reason: "pull_request_head_repository_mismatch", target: "main", pullRequestNumber: MAIN_PR_NUMBER });
    });

    it("returns pull_request_closed when the live PR is closed without being merged", async () => {
      const { repository } = createFakeReleaseIntentRepository({ data: validIntentDocument() });
      const { observeGithubPullRequest } = fakeObserveByNumber({
        [MAIN_PR_NUMBER]: { ok: true, pullRequest: observedPullRequest({ number: MAIN_PR_NUMBER, baseRef: "main", state: "closed", merged: false }) },
      });

      const result = await evaluateReleaseMergeEligibility({
        releaseIntentId: RELEASE_INTENT_ID,
        target: "main",
        repository,
        observeGithubPullRequest,
      });

      expect(result).toEqual({ eligible: false, reason: "pull_request_closed", target: "main", pullRequestNumber: MAIN_PR_NUMBER });
    });

    it("returns pull_request_draft when the live PR is a draft", async () => {
      const { repository } = createFakeReleaseIntentRepository({ data: validIntentDocument() });
      const { observeGithubPullRequest } = fakeObserveByNumber({
        [MAIN_PR_NUMBER]: { ok: true, pullRequest: observedPullRequest({ number: MAIN_PR_NUMBER, baseRef: "main", draft: true }) },
      });

      const result = await evaluateReleaseMergeEligibility({
        releaseIntentId: RELEASE_INTENT_ID,
        target: "main",
        repository,
        observeGithubPullRequest,
      });

      expect(result).toEqual({ eligible: false, reason: "pull_request_draft", target: "main", pullRequestNumber: MAIN_PR_NUMBER });
    });

    it("returns mergeability_pending when GitHub has not yet computed mergeability", async () => {
      const { repository } = createFakeReleaseIntentRepository({ data: validIntentDocument() });
      const { observeGithubPullRequest } = fakeObserveByNumber({
        [MAIN_PR_NUMBER]: { ok: true, pullRequest: observedPullRequest({ number: MAIN_PR_NUMBER, baseRef: "main", mergeable: null }) },
      });

      const result = await evaluateReleaseMergeEligibility({
        releaseIntentId: RELEASE_INTENT_ID,
        target: "main",
        repository,
        observeGithubPullRequest,
      });

      expect(result).toEqual({ eligible: false, reason: "mergeability_pending", target: "main", pullRequestNumber: MAIN_PR_NUMBER });
    });

    it("returns not_mergeable when GitHub reports a conflict", async () => {
      const { repository } = createFakeReleaseIntentRepository({ data: validIntentDocument() });
      const { observeGithubPullRequest } = fakeObserveByNumber({
        [MAIN_PR_NUMBER]: { ok: true, pullRequest: observedPullRequest({ number: MAIN_PR_NUMBER, baseRef: "main", mergeable: false }) },
      });

      const result = await evaluateReleaseMergeEligibility({
        releaseIntentId: RELEASE_INTENT_ID,
        target: "main",
        repository,
        observeGithubPullRequest,
      });

      expect(result).toEqual({ eligible: false, reason: "not_mergeable", target: "main", pullRequestNumber: MAIN_PR_NUMBER });
    });
  });

  describe("target: main — already-merged recovery", () => {
    it("returns pull_request_already_merged when live identity fully agrees and a merge commit SHA exists", async () => {
      const { repository } = createFakeReleaseIntentRepository({ data: validIntentDocument() });
      const { observeGithubPullRequest } = fakeObserveByNumber({ [MAIN_PR_NUMBER]: MAIN_ALREADY_MERGED });

      const result = await evaluateReleaseMergeEligibility({
        releaseIntentId: RELEASE_INTENT_ID,
        target: "main",
        repository,
        observeGithubPullRequest,
      });

      expect(result).toEqual({
        eligible: false,
        reason: "pull_request_already_merged",
        releaseIntentId: RELEASE_INTENT_ID,
        target: "main",
        repository: REPOSITORY,
        pullRequestNumber: MAIN_PR_NUMBER,
        headSha: RELEASE_COMMIT_SHA,
        mergeCommitSha: "e".repeat(40),
      });
    });

    it("fails closed with a head SHA mismatch reason rather than trusting an already-merged PR with a different head", async () => {
      const { repository } = createFakeReleaseIntentRepository({ data: validIntentDocument() });
      const { observeGithubPullRequest } = fakeObserveByNumber({
        [MAIN_PR_NUMBER]: {
          ok: true,
          pullRequest: observedPullRequest({ number: MAIN_PR_NUMBER, baseRef: "main", state: "closed", merged: true, headSha: OTHER_COMMIT_SHA, mergeCommitSha: "e".repeat(40) }),
        },
      });

      const result = await evaluateReleaseMergeEligibility({
        releaseIntentId: RELEASE_INTENT_ID,
        target: "main",
        repository,
        observeGithubPullRequest,
      });

      expect(result).toEqual({ eligible: false, reason: "pull_request_already_merged_head_sha_mismatch", target: "main", pullRequestNumber: MAIN_PR_NUMBER });
    });

    it("fails closed with a head branch mismatch reason", async () => {
      const { repository } = createFakeReleaseIntentRepository({ data: validIntentDocument() });
      const { observeGithubPullRequest } = fakeObserveByNumber({
        [MAIN_PR_NUMBER]: {
          ok: true,
          pullRequest: observedPullRequest({ number: MAIN_PR_NUMBER, baseRef: "main", state: "closed", merged: true, headRef: "some-other-branch", mergeCommitSha: "e".repeat(40) }),
        },
      });

      const result = await evaluateReleaseMergeEligibility({
        releaseIntentId: RELEASE_INTENT_ID,
        target: "main",
        repository,
        observeGithubPullRequest,
      });

      expect(result).toEqual({ eligible: false, reason: "pull_request_already_merged_head_branch_mismatch", target: "main", pullRequestNumber: MAIN_PR_NUMBER });
    });

    it("fails closed with a base branch mismatch reason", async () => {
      const { repository } = createFakeReleaseIntentRepository({ data: validIntentDocument() });
      const { observeGithubPullRequest } = fakeObserveByNumber({
        [MAIN_PR_NUMBER]: {
          ok: true,
          pullRequest: observedPullRequest({ number: MAIN_PR_NUMBER, baseRef: "develop", state: "closed", merged: true, mergeCommitSha: "e".repeat(40) }),
        },
      });

      const result = await evaluateReleaseMergeEligibility({
        releaseIntentId: RELEASE_INTENT_ID,
        target: "main",
        repository,
        observeGithubPullRequest,
      });

      expect(result).toEqual({ eligible: false, reason: "pull_request_already_merged_base_branch_mismatch", target: "main", pullRequestNumber: MAIN_PR_NUMBER });
    });

    it("fails closed with a commit SHA missing reason when GitHub supplies no merge commit SHA", async () => {
      const { repository } = createFakeReleaseIntentRepository({ data: validIntentDocument() });
      const { observeGithubPullRequest } = fakeObserveByNumber({
        [MAIN_PR_NUMBER]: {
          ok: true,
          pullRequest: observedPullRequest({ number: MAIN_PR_NUMBER, baseRef: "main", state: "closed", merged: true, mergeCommitSha: null }),
        },
      });

      const result = await evaluateReleaseMergeEligibility({
        releaseIntentId: RELEASE_INTENT_ID,
        target: "main",
        repository,
        observeGithubPullRequest,
      });

      expect(result).toEqual({ eligible: false, reason: "pull_request_already_merged_commit_sha_missing", target: "main", pullRequestNumber: MAIN_PR_NUMBER });
    });

    it("fails closed with a repository mismatch reason even for a merged PR, before checking merge state", async () => {
      const { repository } = createFakeReleaseIntentRepository({ data: validIntentDocument() });
      const { observeGithubPullRequest } = fakeObserveByNumber({
        [MAIN_PR_NUMBER]: {
          ok: true,
          pullRequest: observedPullRequest({ number: MAIN_PR_NUMBER, baseRef: "main", state: "closed", merged: true, baseRepositoryFullName: "someone/fork", mergeCommitSha: "e".repeat(40) }),
        },
      });

      const result = await evaluateReleaseMergeEligibility({
        releaseIntentId: RELEASE_INTENT_ID,
        target: "main",
        repository,
        observeGithubPullRequest,
      });

      expect(result).toEqual({ eligible: false, reason: "pull_request_repository_mismatch", target: "main", pullRequestNumber: MAIN_PR_NUMBER });
    });
  });

  describe("target: develop — merge ordering prerequisite (main must be verified merged first)", () => {
    it("is eligible for develop once main is verified, live, as safely merged", async () => {
      const { repository } = createFakeReleaseIntentRepository({ data: validIntentDocument() });
      const { observeGithubPullRequest, calls } = fakeObserveByNumber({
        [MAIN_PR_NUMBER]: MAIN_ALREADY_MERGED,
        [DEVELOP_PR_NUMBER]: DEVELOP_OPEN_MERGEABLE,
      });

      const result = await evaluateReleaseMergeEligibility({
        releaseIntentId: RELEASE_INTENT_ID,
        target: "develop",
        repository,
        observeGithubPullRequest,
      });

      expect(result).toEqual({
        eligible: true,
        releaseIntentId: RELEASE_INTENT_ID,
        target: "develop",
        repository: REPOSITORY,
        pullRequestNumber: DEVELOP_PR_NUMBER,
        headSha: RELEASE_COMMIT_SHA,
      });
      expect(calls.map((call) => call.pullRequestNumber)).toEqual([MAIN_PR_NUMBER, DEVELOP_PR_NUMBER]);
    });

    it("returns main_pull_request_merge_unverified when main is still open — develop is never independently eligible", async () => {
      const { repository } = createFakeReleaseIntentRepository({ data: validIntentDocument() });
      const { observeGithubPullRequest, calls } = fakeObserveByNumber({
        [MAIN_PR_NUMBER]: { ok: true, pullRequest: observedPullRequest({ number: MAIN_PR_NUMBER, baseRef: "main" }) },
        [DEVELOP_PR_NUMBER]: DEVELOP_OPEN_MERGEABLE,
      });

      const result = await evaluateReleaseMergeEligibility({
        releaseIntentId: RELEASE_INTENT_ID,
        target: "develop",
        repository,
        observeGithubPullRequest,
      });

      expect(result).toEqual({ eligible: false, reason: "main_pull_request_merge_unverified" });
      // Never observes develop once the main prerequisite fails — the ordering gate short-circuits.
      expect(calls.map((call) => call.pullRequestNumber)).toEqual([MAIN_PR_NUMBER]);
    });

    it("returns main_pull_request_merge_unverified when main is merged but the live identity disagrees", async () => {
      const { repository } = createFakeReleaseIntentRepository({ data: validIntentDocument() });
      const { observeGithubPullRequest, calls } = fakeObserveByNumber({
        [MAIN_PR_NUMBER]: {
          ok: true,
          pullRequest: observedPullRequest({ number: MAIN_PR_NUMBER, baseRef: "main", state: "closed", merged: true, headSha: OTHER_COMMIT_SHA, mergeCommitSha: "e".repeat(40) }),
        },
        [DEVELOP_PR_NUMBER]: DEVELOP_OPEN_MERGEABLE,
      });

      const result = await evaluateReleaseMergeEligibility({
        releaseIntentId: RELEASE_INTENT_ID,
        target: "develop",
        repository,
        observeGithubPullRequest,
      });

      expect(result).toEqual({ eligible: false, reason: "main_pull_request_merge_unverified" });
      expect(calls.map((call) => call.pullRequestNumber)).toEqual([MAIN_PR_NUMBER]);
    });

    it("returns main_pull_request_merge_unverified when main is merged but GitHub supplies no merge commit SHA", async () => {
      const { repository } = createFakeReleaseIntentRepository({ data: validIntentDocument() });
      const { observeGithubPullRequest, calls } = fakeObserveByNumber({
        [MAIN_PR_NUMBER]: {
          ok: true,
          pullRequest: observedPullRequest({ number: MAIN_PR_NUMBER, baseRef: "main", state: "closed", merged: true, mergeCommitSha: null }),
        },
        [DEVELOP_PR_NUMBER]: DEVELOP_OPEN_MERGEABLE,
      });

      const result = await evaluateReleaseMergeEligibility({
        releaseIntentId: RELEASE_INTENT_ID,
        target: "develop",
        repository,
        observeGithubPullRequest,
      });

      expect(result).toEqual({ eligible: false, reason: "main_pull_request_merge_unverified" });
      expect(calls.map((call) => call.pullRequestNumber)).toEqual([MAIN_PR_NUMBER]);
    });

    it("returns main_prerequisite_observation_error when observing main throws unexpectedly", async () => {
      const { repository } = createFakeReleaseIntentRepository({ data: validIntentDocument() });
      const { observeGithubPullRequest, calls } = fakeObserveByNumber({ [MAIN_PR_NUMBER]: new Error("network down") });

      const result = await evaluateReleaseMergeEligibility({
        releaseIntentId: RELEASE_INTENT_ID,
        target: "develop",
        repository,
        observeGithubPullRequest,
      });

      expect(result).toEqual({ eligible: false, reason: "main_prerequisite_observation_error" });
      expect(calls.map((call) => call.pullRequestNumber)).toEqual([MAIN_PR_NUMBER]);
    });

    it("does not check the main prerequisite at all when target is main", async () => {
      const { repository } = createFakeReleaseIntentRepository({ data: validIntentDocument() });
      const { observeGithubPullRequest, calls } = fakeObserveByNumber({
        [MAIN_PR_NUMBER]: { ok: true, pullRequest: observedPullRequest({ number: MAIN_PR_NUMBER, baseRef: "main" }) },
      });

      await evaluateReleaseMergeEligibility({
        releaseIntentId: RELEASE_INTENT_ID,
        target: "main",
        repository,
        observeGithubPullRequest,
      });

      expect(calls).toHaveLength(1);
    });
  });

  describe("target: develop — develop's own reconciliation failures after main clears the ordering gate", () => {
    it("returns pull_request_observation_error when observing develop's own PR throws, after main was verified merged", async () => {
      const { repository } = createFakeReleaseIntentRepository({ data: validIntentDocument() });
      const { observeGithubPullRequest, calls } = fakeObserveByNumber({
        [MAIN_PR_NUMBER]: MAIN_ALREADY_MERGED,
        [DEVELOP_PR_NUMBER]: new Error("network down"),
      });

      const result = await evaluateReleaseMergeEligibility({
        releaseIntentId: RELEASE_INTENT_ID,
        target: "develop",
        repository,
        observeGithubPullRequest,
      });

      expect(result).toEqual({ eligible: false, reason: "pull_request_observation_error", target: "develop", pullRequestNumber: DEVELOP_PR_NUMBER });
      expect(calls.map((call) => call.pullRequestNumber)).toEqual([MAIN_PR_NUMBER, DEVELOP_PR_NUMBER]);
    });
  });

  describe("target: develop — already-merged recovery still applies to develop itself", () => {
    it("returns pull_request_already_merged for develop once main is verified merged and develop is also already merged", async () => {
      const { repository } = createFakeReleaseIntentRepository({ data: validIntentDocument() });
      const { observeGithubPullRequest } = fakeObserveByNumber({
        [MAIN_PR_NUMBER]: MAIN_ALREADY_MERGED,
        [DEVELOP_PR_NUMBER]: {
          ok: true,
          pullRequest: observedPullRequest({ number: DEVELOP_PR_NUMBER, baseRef: "develop", state: "closed", merged: true, mergeCommitSha: "f".repeat(40) }),
        },
      });

      const result = await evaluateReleaseMergeEligibility({
        releaseIntentId: RELEASE_INTENT_ID,
        target: "develop",
        repository,
        observeGithubPullRequest,
      });

      expect(result).toEqual({
        eligible: false,
        reason: "pull_request_already_merged",
        releaseIntentId: RELEASE_INTENT_ID,
        target: "develop",
        repository: REPOSITORY,
        pullRequestNumber: DEVELOP_PR_NUMBER,
        headSha: RELEASE_COMMIT_SHA,
        mergeCommitSha: "f".repeat(40),
      });
    });
  });
});
