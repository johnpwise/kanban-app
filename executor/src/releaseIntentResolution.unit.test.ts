import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, it, vi } from "vitest";

import { ensureReleaseIntentRecorded } from "./releaseIntentResolution";
import { deriveReleaseIntentId } from "./schemas/releaseIntentDocument";

import type { ReleaseIntentRepository } from "./releaseIntentRepository";
import type { ObserveGitRefSha } from "./releaseRepositoryObservation";

const REPOSITORY = "johnpwise/kanban-app";
const SOURCE_BRANCH = "develop";
const VERSION = "0.2.0";
const RELEASE_INTENT_ID = deriveReleaseIntentId(REPOSITORY, VERSION);
const SOURCE_REVISION = "a".repeat(40);

function fakeRepository(overrides: {
  data?: unknown;
  loadThrows?: Error;
  recordReleaseIntent?: { outcome: "created" } | { outcome: "already_recorded" } | { outcome: "conflict" };
  recordThrows?: Error;
}): { repository: ReleaseIntentRepository; recordCalls: unknown[] } {
  const recordCalls: unknown[] = [];
  return {
    recordCalls,
    repository: {
      async loadReleaseIntentData() {
        if (overrides.loadThrows) {
          throw overrides.loadThrows;
        }
        return overrides.data;
      },
      async recordReleaseIntent(releaseIntentId, identity) {
        recordCalls.push({ releaseIntentId, identity });
        if (overrides.recordThrows) {
          throw overrides.recordThrows;
        }
        return overrides.recordReleaseIntent ?? { outcome: "created" };
      },
      async recordReleaseStartResult() {
        throw new Error("not used by this resolution boundary");
      },
    },
  };
}

function fakeObserveGitRef(
  outcome: { ok: true; found: true; sha: string } | { ok: true; found: false } | { ok: false; reason: string },
): ObserveGitRefSha {
  return vi.fn(async () => outcome as Awaited<ReturnType<ObserveGitRefSha>>);
}

const BASE_PARAMS = {
  releaseIntentId: RELEASE_INTENT_ID,
  expectedRepository: REPOSITORY,
  expectedSourceBranch: SOURCE_BRANCH,
};

describe("ensureReleaseIntentRecorded", () => {
  it("returns recorded (idempotent replay) when a matching intent is already persisted", async () => {
    // Arrange
    const { repository, recordCalls } = fakeRepository({
      data: {
        releaseIntentId: RELEASE_INTENT_ID,
        repository: REPOSITORY,
        version: VERSION,
        sourceBranch: SOURCE_BRANCH,
        sourceRevision: SOURCE_REVISION,
        requestedAt: Timestamp.fromMillis(0),
      },
    });
    const observeGitRef = fakeObserveGitRef({ ok: false, reason: "should not be called" });

    // Act
    const outcome = await ensureReleaseIntentRecorded({ ...BASE_PARAMS, repository, observeGitRef });

    // Assert
    expect(outcome).toEqual({
      outcome: "recorded",
      releaseIntentId: RELEASE_INTENT_ID,
      repository: REPOSITORY,
      version: VERSION,
      sourceBranch: SOURCE_BRANCH,
      sourceRevision: SOURCE_REVISION,
    });
    expect(recordCalls).toHaveLength(0);
    expect(observeGitRef).not.toHaveBeenCalled();
  });

  it("fails closed when the persisted intent's repository disagrees with the trusted configuration", async () => {
    // Arrange
    const { repository } = fakeRepository({
      data: {
        releaseIntentId: RELEASE_INTENT_ID,
        repository: "someone-else/other-repo",
        version: VERSION,
        sourceBranch: SOURCE_BRANCH,
        sourceRevision: SOURCE_REVISION,
        requestedAt: Timestamp.fromMillis(0),
      },
    });
    const observeGitRef = fakeObserveGitRef({ ok: false, reason: "should not be called" });

    // Act
    const outcome = await ensureReleaseIntentRecorded({ ...BASE_PARAMS, repository, observeGitRef });

    // Assert
    expect(outcome).toEqual({ outcome: "release_intent_resolution_repository_mismatch", releaseIntentId: RELEASE_INTENT_ID });
  });

  it("fails closed when the persisted intent's sourceBranch disagrees with the trusted configuration", async () => {
    // Arrange
    const { repository } = fakeRepository({
      data: {
        releaseIntentId: RELEASE_INTENT_ID,
        repository: REPOSITORY,
        version: VERSION,
        sourceBranch: "main",
        sourceRevision: SOURCE_REVISION,
        requestedAt: Timestamp.fromMillis(0),
      },
    });
    const observeGitRef = fakeObserveGitRef({ ok: false, reason: "should not be called" });

    // Act
    const outcome = await ensureReleaseIntentRecorded({ ...BASE_PARAMS, repository, observeGitRef });

    // Assert
    expect(outcome).toEqual({ outcome: "release_intent_resolution_source_branch_mismatch", releaseIntentId: RELEASE_INTENT_ID });
  });

  it("fails closed when the persisted intent fails schema validation", async () => {
    // Arrange
    const { repository } = fakeRepository({ data: { releaseIntentId: RELEASE_INTENT_ID, repository: "not valid" } });
    const observeGitRef = fakeObserveGitRef({ ok: false, reason: "should not be called" });

    // Act
    const outcome = await ensureReleaseIntentRecorded({ ...BASE_PARAMS, repository, observeGitRef });

    // Assert
    expect(outcome).toEqual({ outcome: "release_intent_resolution_invalid", releaseIntentId: RELEASE_INTENT_ID });
  });

  it("fails closed when loading the existing intent throws", async () => {
    // Arrange
    const { repository } = fakeRepository({ loadThrows: new Error("firestore unavailable") });
    const observeGitRef = fakeObserveGitRef({ ok: false, reason: "should not be called" });

    // Act
    const outcome = await ensureReleaseIntentRecorded({ ...BASE_PARAMS, repository, observeGitRef });

    // Assert
    expect(outcome).toEqual({ outcome: "release_intent_resolution_load_error", releaseIntentId: RELEASE_INTENT_ID });
  });

  it("freshly observes the trusted source branch and records a new intent when none exists yet", async () => {
    // Arrange
    const { repository, recordCalls } = fakeRepository({ data: undefined, recordReleaseIntent: { outcome: "created" } });
    const observeGitRef = fakeObserveGitRef({ ok: true, found: true, sha: SOURCE_REVISION });

    // Act
    const outcome = await ensureReleaseIntentRecorded({ ...BASE_PARAMS, repository, observeGitRef });

    // Assert
    expect(outcome).toEqual({
      outcome: "recorded",
      releaseIntentId: RELEASE_INTENT_ID,
      repository: REPOSITORY,
      version: VERSION,
      sourceBranch: SOURCE_BRANCH,
      sourceRevision: SOURCE_REVISION,
    });
    expect(recordCalls).toEqual([
      {
        releaseIntentId: RELEASE_INTENT_ID,
        identity: { repository: REPOSITORY, version: VERSION, sourceBranch: SOURCE_BRANCH, sourceRevision: SOURCE_REVISION },
      },
    ]);
    expect(observeGitRef).toHaveBeenCalledWith({ repository: REPOSITORY, ref: `heads/${SOURCE_BRANCH}` });
  });

  it("treats recordReleaseIntent's already_recorded outcome as a successful idempotent convergence", async () => {
    // Arrange
    const { repository } = fakeRepository({ data: undefined, recordReleaseIntent: { outcome: "already_recorded" } });
    const observeGitRef = fakeObserveGitRef({ ok: true, found: true, sha: SOURCE_REVISION });

    // Act
    const outcome = await ensureReleaseIntentRecorded({ ...BASE_PARAMS, repository, observeGitRef });

    // Assert
    expect(outcome.outcome).toBe("recorded");
  });

  it("fails closed when the release intent id cannot be decoded against the trusted repository", async () => {
    // Arrange
    const { repository } = fakeRepository({ data: undefined });
    const observeGitRef = fakeObserveGitRef({ ok: true, found: true, sha: SOURCE_REVISION });

    // Act
    const outcome = await ensureReleaseIntentRecorded({
      ...BASE_PARAMS,
      releaseIntentId: "not-a-valid-release-intent-id",
      repository,
      observeGitRef,
    });

    // Assert
    expect(outcome).toEqual({
      outcome: "release_intent_resolution_version_undecodable",
      releaseIntentId: "not-a-valid-release-intent-id",
    });
    expect(observeGitRef).not.toHaveBeenCalled();
  });

  it("fails closed when the fresh source-branch observation errors", async () => {
    // Arrange
    const { repository } = fakeRepository({ data: undefined });
    const observeGitRef = fakeObserveGitRef({ ok: false, reason: "ref_lookup_network_error" });

    // Act
    const outcome = await ensureReleaseIntentRecorded({ ...BASE_PARAMS, repository, observeGitRef });

    // Assert
    expect(outcome).toEqual({
      outcome: "release_intent_resolution_source_branch_observation_error",
      releaseIntentId: RELEASE_INTENT_ID,
    });
  });

  it("fails closed when the trusted source branch does not exist", async () => {
    // Arrange
    const { repository } = fakeRepository({ data: undefined });
    const observeGitRef = fakeObserveGitRef({ ok: true, found: false });

    // Act
    const outcome = await ensureReleaseIntentRecorded({ ...BASE_PARAMS, repository, observeGitRef });

    // Assert
    expect(outcome).toEqual({
      outcome: "release_intent_resolution_source_branch_not_found",
      releaseIntentId: RELEASE_INTENT_ID,
    });
  });

  it("never silently records over a conflicting concurrent intent", async () => {
    // Arrange
    const { repository } = fakeRepository({ data: undefined, recordReleaseIntent: { outcome: "conflict" } });
    const observeGitRef = fakeObserveGitRef({ ok: true, found: true, sha: SOURCE_REVISION });

    // Act
    const outcome = await ensureReleaseIntentRecorded({ ...BASE_PARAMS, repository, observeGitRef });

    // Assert
    expect(outcome).toEqual({ outcome: "release_intent_resolution_conflict", releaseIntentId: RELEASE_INTENT_ID });
  });

  it("fails closed when recording the intent throws", async () => {
    // Arrange
    const { repository } = fakeRepository({ data: undefined, recordThrows: new Error("firestore unavailable") });
    const observeGitRef = fakeObserveGitRef({ ok: true, found: true, sha: SOURCE_REVISION });

    // Act
    const outcome = await ensureReleaseIntentRecorded({ ...BASE_PARAMS, repository, observeGitRef });

    // Assert
    expect(outcome).toEqual({ outcome: "release_intent_resolution_persistence_error", releaseIntentId: RELEASE_INTENT_ID });
  });
});
