import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, it, vi } from "vitest";

import { evaluateReleasePullRequestEligibility } from "./releasePullRequestEligibility";

import type { ReleaseIntentRepository } from "./releaseIntentRepository";
import type { ObserveGitRefSha } from "./releaseRepositoryObservation";

const REPOSITORY = "johnpwise/kanban-app";
const RELEASE_INTENT_ID = "johnpwise__kanban-app--0.2.0";
const VERSION = "0.2.0";
const SOURCE_BRANCH = "develop";
const SOURCE_REVISION = "a".repeat(40);
const RELEASE_BRANCH = "release/0.2.0";
const RELEASE_COMMIT_SHA = "c".repeat(40);
const OTHER_COMMIT_SHA = "d".repeat(40);

const validIntentDocumentWithStart = {
  releaseIntentId: RELEASE_INTENT_ID,
  repository: REPOSITORY,
  version: VERSION,
  sourceBranch: SOURCE_BRANCH,
  sourceRevision: SOURCE_REVISION,
  requestedAt: Timestamp.fromMillis(0),
  start: { releaseBranch: RELEASE_BRANCH, commitSha: RELEASE_COMMIT_SHA, recordedAt: Timestamp.fromMillis(0) },
};

function fakeRepository(data: unknown, throwError?: Error): ReleaseIntentRepository {
  return {
    loadReleaseIntentData: vi.fn(async () => {
      if (throwError) throw throwError;
      return data;
    }),
  } as unknown as ReleaseIntentRepository;
}

function fakeObserveGitRef(byRef: Record<string, { found: true; sha: string } | { found: false } | { error: true }>): ObserveGitRefSha {
  return vi.fn(async ({ ref }) => {
    const entry = byRef[ref];
    if (!entry) {
      throw new Error(`unexpected ref lookup: ${ref}`);
    }
    if ("error" in entry) {
      return { ok: false, reason: "ref_lookup_failed", httpStatus: 500 };
    }
    return { ok: true, ...entry };
  });
}

const FULLY_RECONCILED_REFS = {
  [`heads/${RELEASE_BRANCH}`]: { found: true as const, sha: RELEASE_COMMIT_SHA },
  "heads/main": { found: true as const, sha: "e".repeat(40) },
  "heads/develop": { found: true as const, sha: "f".repeat(40) },
};

describe("evaluateReleasePullRequestEligibility", () => {
  it("is eligible when the release branch head matches the trusted start commit and both bases exist", async () => {
    // Arrange
    const repository = fakeRepository(validIntentDocumentWithStart);
    const observeGitRef = fakeObserveGitRef(FULLY_RECONCILED_REFS);

    // Act
    const result = await evaluateReleasePullRequestEligibility({
      releaseIntentId: RELEASE_INTENT_ID,
      expectedRepository: REPOSITORY,
      repository,
      observeGitRef,
    });

    // Assert
    expect(result).toEqual({
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
    });
  });

  it("returns release_intent_load_error when loading the release intent throws", async () => {
    // Arrange
    const repository = fakeRepository(undefined, new Error("firestore unavailable"));
    const observeGitRef = fakeObserveGitRef({});

    // Act
    const result = await evaluateReleasePullRequestEligibility({
      releaseIntentId: RELEASE_INTENT_ID,
      expectedRepository: REPOSITORY,
      repository,
      observeGitRef,
    });

    // Assert
    expect(result).toEqual({ eligible: false, reason: "release_intent_load_error" });
  });

  it("returns release_intent_not_found when no such release intent exists", async () => {
    // Arrange
    const repository = fakeRepository(undefined);
    const observeGitRef = fakeObserveGitRef({});

    // Act
    const result = await evaluateReleasePullRequestEligibility({
      releaseIntentId: RELEASE_INTENT_ID,
      expectedRepository: REPOSITORY,
      repository,
      observeGitRef,
    });

    // Assert
    expect(result).toEqual({ eligible: false, reason: "release_intent_not_found" });
  });

  it("returns release_intent_invalid when the persisted document fails schema validation", async () => {
    // Arrange
    const repository = fakeRepository({ ...validIntentDocumentWithStart, version: "v0.2.0" });
    const observeGitRef = fakeObserveGitRef({});

    // Act
    const result = await evaluateReleasePullRequestEligibility({
      releaseIntentId: RELEASE_INTENT_ID,
      expectedRepository: REPOSITORY,
      repository,
      observeGitRef,
    });

    // Assert
    expect(result).toEqual({ eligible: false, reason: "release_intent_invalid" });
  });

  it("returns repository_mismatch when the persisted intent's repository disagrees with the trusted expected repository", async () => {
    // Arrange
    const repository = fakeRepository({ ...validIntentDocumentWithStart, repository: "someone-else/other-repo" });
    const observeGitRef = fakeObserveGitRef({});

    // Act
    const result = await evaluateReleasePullRequestEligibility({
      releaseIntentId: RELEASE_INTENT_ID,
      expectedRepository: REPOSITORY,
      repository,
      observeGitRef,
    });

    // Assert
    expect(result).toEqual({ eligible: false, reason: "repository_mismatch" });
  });

  it("returns release_start_missing when the release intent has no durable start result yet", async () => {
    // Arrange
    const withoutStart: Record<string, unknown> = { ...validIntentDocumentWithStart };
    delete withoutStart.start;
    const repository = fakeRepository(withoutStart);
    const observeGitRef = fakeObserveGitRef({});

    // Act
    const result = await evaluateReleasePullRequestEligibility({
      releaseIntentId: RELEASE_INTENT_ID,
      expectedRepository: REPOSITORY,
      repository,
      observeGitRef,
    });

    // Assert
    expect(result).toEqual({ eligible: false, reason: "release_start_missing" });
  });

  it("returns release_branch_observation_error when observing the release branch fails", async () => {
    // Arrange
    const repository = fakeRepository(validIntentDocumentWithStart);
    const observeGitRef = fakeObserveGitRef({ [`heads/${RELEASE_BRANCH}`]: { error: true } });

    // Act
    const result = await evaluateReleasePullRequestEligibility({
      releaseIntentId: RELEASE_INTENT_ID,
      expectedRepository: REPOSITORY,
      repository,
      observeGitRef,
    });

    // Assert
    expect(result).toEqual({ eligible: false, reason: "release_branch_observation_error" });
  });

  it("returns release_branch_not_found when the trusted release branch no longer exists", async () => {
    // Arrange
    const repository = fakeRepository(validIntentDocumentWithStart);
    const observeGitRef = fakeObserveGitRef({ [`heads/${RELEASE_BRANCH}`]: { found: false } });

    // Act
    const result = await evaluateReleasePullRequestEligibility({
      releaseIntentId: RELEASE_INTENT_ID,
      expectedRepository: REPOSITORY,
      repository,
      observeGitRef,
    });

    // Assert
    expect(result).toEqual({ eligible: false, reason: "release_branch_not_found", releaseBranch: RELEASE_BRANCH });
  });

  it("returns release_branch_head_drift when the release branch head no longer matches the persisted start commit", async () => {
    // Arrange
    const repository = fakeRepository(validIntentDocumentWithStart);
    const observeGitRef = fakeObserveGitRef({ [`heads/${RELEASE_BRANCH}`]: { found: true, sha: OTHER_COMMIT_SHA } });

    // Act
    const result = await evaluateReleasePullRequestEligibility({
      releaseIntentId: RELEASE_INTENT_ID,
      expectedRepository: REPOSITORY,
      repository,
      observeGitRef,
    });

    // Assert
    expect(result).toEqual({
      eligible: false,
      reason: "release_branch_head_drift",
      releaseBranch: RELEASE_BRANCH,
      expectedCommitSha: RELEASE_COMMIT_SHA,
      actualCommitSha: OTHER_COMMIT_SHA,
    });
  });

  it("returns base_branch_observation_error for main when observing it fails", async () => {
    // Arrange
    const repository = fakeRepository(validIntentDocumentWithStart);
    const observeGitRef = fakeObserveGitRef({
      [`heads/${RELEASE_BRANCH}`]: { found: true, sha: RELEASE_COMMIT_SHA },
      "heads/main": { error: true },
    });

    // Act
    const result = await evaluateReleasePullRequestEligibility({
      releaseIntentId: RELEASE_INTENT_ID,
      expectedRepository: REPOSITORY,
      repository,
      observeGitRef,
    });

    // Assert
    expect(result).toEqual({ eligible: false, reason: "base_branch_observation_error", base: "main" });
  });

  it("returns base_branch_not_found for develop when it does not exist", async () => {
    // Arrange
    const repository = fakeRepository(validIntentDocumentWithStart);
    const observeGitRef = fakeObserveGitRef({
      [`heads/${RELEASE_BRANCH}`]: { found: true, sha: RELEASE_COMMIT_SHA },
      "heads/main": { found: true, sha: "e".repeat(40) },
      "heads/develop": { found: false },
    });

    // Act
    const result = await evaluateReleasePullRequestEligibility({
      releaseIntentId: RELEASE_INTENT_ID,
      expectedRepository: REPOSITORY,
      repository,
      observeGitRef,
    });

    // Assert
    expect(result).toEqual({ eligible: false, reason: "base_branch_not_found", base: "develop" });
  });
});
