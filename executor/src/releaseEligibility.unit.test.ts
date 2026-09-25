import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, it, vi } from "vitest";

import { evaluateReleaseEligibility } from "./releaseEligibility";

import type { ReleaseIntentRepository } from "./releaseIntentRepository";
import type { ObserveGitRefSha, ObservePackageVersion } from "./releaseRepositoryObservation";

const REPOSITORY = "johnpwise/kanban-app";
const SOURCE_BRANCH = "develop";
const RELEASE_INTENT_ID = "johnpwise__kanban-app--0.2.0";
const VERSION = "0.2.0";
const SOURCE_REVISION = "a".repeat(40);
const OTHER_REVISION = "b".repeat(40);
const RELEASE_BRANCH_SHA = "c".repeat(40);

const validIntentDocument = {
  releaseIntentId: RELEASE_INTENT_ID,
  repository: REPOSITORY,
  version: VERSION,
  sourceBranch: SOURCE_BRANCH,
  sourceRevision: SOURCE_REVISION,
  requestedAt: Timestamp.fromMillis(0),
};

function fakeRepository(data: unknown): ReleaseIntentRepository {
  return {
    loadReleaseIntentData: vi.fn(async () => data),
    recordReleaseIntent: vi.fn(async () => ({ outcome: "created" }) as const),
  };
}

function fakeObserveGitRef(byRef: Record<string, { found: true; sha: string } | { found: false }>): ObserveGitRefSha {
  return vi.fn(async ({ ref }) => {
    const entry = byRef[ref];
    if (!entry) {
      throw new Error(`unexpected ref lookup: ${ref}`);
    }
    return { ok: true, ...entry };
  });
}

function fakeObservePackageVersion(
  byRef: Record<string, { found: true; version: string } | { found: false }>,
): ObservePackageVersion {
  return vi.fn(async ({ ref }) => {
    const entry = byRef[ref];
    if (!entry) {
      throw new Error(`unexpected package version lookup: ${ref}`);
    }
    return { ok: true, ...entry };
  });
}

const BASE_PARAMS = {
  releaseIntentId: RELEASE_INTENT_ID,
  expectedRepository: REPOSITORY,
  expectedSourceBranch: SOURCE_BRANCH,
};

describe("evaluateReleaseEligibility", () => {
  it("is eligible when durable intent and fresh authoritative state fully agree", async () => {
    // Arrange
    const repository = fakeRepository(validIntentDocument);
    const observeGitRef = fakeObserveGitRef({
      [`heads/${SOURCE_BRANCH}`]: { found: true, sha: SOURCE_REVISION },
      [`heads/release/${VERSION}`]: { found: false },
      [`tags/v${VERSION}`]: { found: false },
    });
    const observePackageVersion = fakeObservePackageVersion({
      [SOURCE_REVISION]: { found: true, version: "0.1.0" },
    });

    // Act
    const result = await evaluateReleaseEligibility({ ...BASE_PARAMS, repository, observeGitRef, observePackageVersion });

    // Assert
    expect(result).toEqual({
      eligible: true,
      releaseIntentId: RELEASE_INTENT_ID,
      repository: REPOSITORY,
      version: VERSION,
      sourceBranch: SOURCE_BRANCH,
      sourceRevision: SOURCE_REVISION,
    });
  });

  it("fails closed with release_intent_load_error when the repository throws", async () => {
    // Arrange
    const repository: ReleaseIntentRepository = {
      loadReleaseIntentData: vi.fn(async () => {
        throw new Error("firestore down");
      }),
      recordReleaseIntent: vi.fn(),
    };

    // Act
    const result = await evaluateReleaseEligibility({
      ...BASE_PARAMS,
      repository,
      observeGitRef: vi.fn(),
      observePackageVersion: vi.fn(),
    });

    // Assert
    expect(result).toEqual({ eligible: false, reason: "release_intent_load_error" });
  });

  it("fails closed with release_intent_not_found when no such document exists", async () => {
    // Arrange
    const repository = fakeRepository(undefined);

    // Act
    const result = await evaluateReleaseEligibility({
      ...BASE_PARAMS,
      repository,
      observeGitRef: vi.fn(),
      observePackageVersion: vi.fn(),
    });

    // Assert
    expect(result).toEqual({ eligible: false, reason: "release_intent_not_found" });
  });

  it("fails closed with release_intent_invalid on a malformed persisted document (invalid semver)", async () => {
    // Arrange
    const repository = fakeRepository({ ...validIntentDocument, version: "v0.2.0" });

    // Act
    const result = await evaluateReleaseEligibility({
      ...BASE_PARAMS,
      repository,
      observeGitRef: vi.fn(),
      observePackageVersion: vi.fn(),
    });

    // Assert
    expect(result).toEqual({ eligible: false, reason: "release_intent_invalid" });
  });

  it("fails closed with repository_mismatch when the intent's repository differs from the expected one", async () => {
    // Arrange
    const repository = fakeRepository({ ...validIntentDocument, repository: "someone-else/other-repo" });

    // Act
    const result = await evaluateReleaseEligibility({
      ...BASE_PARAMS,
      repository,
      observeGitRef: vi.fn(),
      observePackageVersion: vi.fn(),
    });

    // Assert
    expect(result).toEqual({ eligible: false, reason: "repository_mismatch" });
  });

  it("fails closed with source_branch_mismatch when the intent's source branch differs from the expected one", async () => {
    // Arrange
    const repository = fakeRepository({ ...validIntentDocument, sourceBranch: "main" });

    // Act
    const result = await evaluateReleaseEligibility({
      ...BASE_PARAMS,
      repository,
      observeGitRef: vi.fn(),
      observePackageVersion: vi.fn(),
    });

    // Assert
    expect(result).toEqual({ eligible: false, reason: "source_branch_mismatch" });
  });

  it("fails closed with source_branch_observation_error when the live ref lookup errors", async () => {
    // Arrange
    const repository = fakeRepository(validIntentDocument);
    const observeGitRef: ObserveGitRefSha = vi.fn(async () => ({ ok: false, reason: "ref_lookup_network_error" }));

    // Act
    const result = await evaluateReleaseEligibility({
      ...BASE_PARAMS,
      repository,
      observeGitRef,
      observePackageVersion: vi.fn(),
    });

    // Assert
    expect(result).toEqual({ eligible: false, reason: "source_branch_observation_error" });
  });

  it("fails closed with source_branch_not_found when the source branch no longer exists", async () => {
    // Arrange
    const repository = fakeRepository(validIntentDocument);
    const observeGitRef = fakeObserveGitRef({ [`heads/${SOURCE_BRANCH}`]: { found: false } });

    // Act
    const result = await evaluateReleaseEligibility({
      ...BASE_PARAMS,
      repository,
      observeGitRef,
      observePackageVersion: vi.fn(),
    });

    // Assert
    expect(result).toEqual({ eligible: false, reason: "source_branch_not_found" });
  });

  it("fails closed with source_revision_drift, reporting both SHAs, without silently substituting the live head", async () => {
    // Arrange
    const repository = fakeRepository(validIntentDocument);
    const observeGitRef = fakeObserveGitRef({
      [`heads/${SOURCE_BRANCH}`]: { found: true, sha: OTHER_REVISION },
    });

    // Act
    const result = await evaluateReleaseEligibility({
      ...BASE_PARAMS,
      repository,
      observeGitRef,
      observePackageVersion: vi.fn(),
    });

    // Assert
    expect(result).toEqual({
      eligible: false,
      reason: "source_revision_drift",
      expectedSourceRevision: SOURCE_REVISION,
      actualSourceRevision: OTHER_REVISION,
    });
  });

  it("fails closed with current_version_observation_error when the package.json read errors", async () => {
    // Arrange
    const repository = fakeRepository(validIntentDocument);
    const observeGitRef = fakeObserveGitRef({ [`heads/${SOURCE_BRANCH}`]: { found: true, sha: SOURCE_REVISION } });
    const observePackageVersion: ObservePackageVersion = vi.fn(async () => ({
      ok: false,
      reason: "package_lookup_network_error",
    }));

    // Act
    const result = await evaluateReleaseEligibility({
      ...BASE_PARAMS,
      repository,
      observeGitRef,
      observePackageVersion,
    });

    // Assert
    expect(result).toEqual({ eligible: false, reason: "current_version_observation_error" });
  });

  it("fails closed with current_version_not_found when package.json is missing at the trusted revision", async () => {
    // Arrange
    const repository = fakeRepository(validIntentDocument);
    const observeGitRef = fakeObserveGitRef({ [`heads/${SOURCE_BRANCH}`]: { found: true, sha: SOURCE_REVISION } });
    const observePackageVersion = fakeObservePackageVersion({ [SOURCE_REVISION]: { found: false } });

    // Act
    const result = await evaluateReleaseEligibility({
      ...BASE_PARAMS,
      repository,
      observeGitRef,
      observePackageVersion,
    });

    // Assert
    expect(result).toEqual({ eligible: false, reason: "current_version_not_found" });
  });

  it("fails closed with current_version_invalid when the live package.json version is malformed", async () => {
    // Arrange
    const repository = fakeRepository(validIntentDocument);
    const observeGitRef = fakeObserveGitRef({ [`heads/${SOURCE_BRANCH}`]: { found: true, sha: SOURCE_REVISION } });
    const observePackageVersion = fakeObservePackageVersion({
      [SOURCE_REVISION]: { found: true, version: "not-a-version" },
    });

    // Act
    const result = await evaluateReleaseEligibility({
      ...BASE_PARAMS,
      repository,
      observeGitRef,
      observePackageVersion,
    });

    // Assert
    expect(result).toEqual({ eligible: false, reason: "current_version_invalid" });
  });

  it("fails closed with requested_version_not_greater when the requested version does not exceed the current one", async () => {
    // Arrange
    const repository = fakeRepository(validIntentDocument);
    const observeGitRef = fakeObserveGitRef({ [`heads/${SOURCE_BRANCH}`]: { found: true, sha: SOURCE_REVISION } });
    const observePackageVersion = fakeObservePackageVersion({
      [SOURCE_REVISION]: { found: true, version: "0.2.0" },
    });

    // Act
    const result = await evaluateReleaseEligibility({
      ...BASE_PARAMS,
      repository,
      observeGitRef,
      observePackageVersion,
    });

    // Assert
    expect(result).toEqual({ eligible: false, reason: "requested_version_not_greater", currentVersion: "0.2.0" });
  });

  it("fails closed with release_branch_observation_error when the release branch ref lookup errors", async () => {
    // Arrange
    const repository = fakeRepository(validIntentDocument);
    const observeGitRef: ObserveGitRefSha = vi.fn(async ({ ref }) => {
      if (ref === `heads/${SOURCE_BRANCH}`) return { ok: true, found: true, sha: SOURCE_REVISION };
      return { ok: false, reason: "ref_lookup_failed", httpStatus: 500 };
    });
    const observePackageVersion = fakeObservePackageVersion({ [SOURCE_REVISION]: { found: true, version: "0.1.0" } });

    // Act
    const result = await evaluateReleaseEligibility({
      ...BASE_PARAMS,
      repository,
      observeGitRef,
      observePackageVersion,
    });

    // Assert
    expect(result).toEqual({ eligible: false, reason: "release_branch_observation_error" });
  });

  it("fails closed with release_branch_version_observation_error (never a false conflict) when the existing release branch's package version cannot be read", async () => {
    // Arrange
    const repository = fakeRepository(validIntentDocument);
    const observeGitRef = fakeObserveGitRef({
      [`heads/${SOURCE_BRANCH}`]: { found: true, sha: SOURCE_REVISION },
      [`heads/release/${VERSION}`]: { found: true, sha: RELEASE_BRANCH_SHA },
    });
    const observePackageVersion: ObservePackageVersion = vi.fn(async ({ ref }) => {
      if (ref === SOURCE_REVISION) return { ok: true, found: true, version: "0.1.0" };
      return { ok: false, reason: "package_lookup_network_error" };
    });

    // Act
    const result = await evaluateReleaseEligibility({
      ...BASE_PARAMS,
      repository,
      observeGitRef,
      observePackageVersion,
    });

    // Assert
    expect(result).toEqual({
      eligible: false,
      reason: "release_branch_version_observation_error",
      releaseBranch: `release/${VERSION}`,
    });
  });

  it("reports already_started (idempotent) when release/<version> exists and already carries the requested version", async () => {
    // Arrange
    const repository = fakeRepository(validIntentDocument);
    const observeGitRef = fakeObserveGitRef({
      [`heads/${SOURCE_BRANCH}`]: { found: true, sha: SOURCE_REVISION },
      [`heads/release/${VERSION}`]: { found: true, sha: RELEASE_BRANCH_SHA },
    });
    const observePackageVersion = fakeObservePackageVersion({
      [SOURCE_REVISION]: { found: true, version: "0.1.0" },
      [RELEASE_BRANCH_SHA]: { found: true, version: VERSION },
    });

    // Act
    const result = await evaluateReleaseEligibility({
      ...BASE_PARAMS,
      repository,
      observeGitRef,
      observePackageVersion,
    });

    // Assert
    expect(result).toEqual({
      eligible: false,
      reason: "already_started",
      releaseBranch: `release/${VERSION}`,
      headSha: RELEASE_BRANCH_SHA,
    });
  });

  it("fails closed with release_branch_conflict when release/<version> exists with a different version", async () => {
    // Arrange
    const repository = fakeRepository(validIntentDocument);
    const observeGitRef = fakeObserveGitRef({
      [`heads/${SOURCE_BRANCH}`]: { found: true, sha: SOURCE_REVISION },
      [`heads/release/${VERSION}`]: { found: true, sha: RELEASE_BRANCH_SHA },
    });
    const observePackageVersion = fakeObservePackageVersion({
      [SOURCE_REVISION]: { found: true, version: "0.1.0" },
      [RELEASE_BRANCH_SHA]: { found: true, version: "0.2.1" },
    });

    // Act
    const result = await evaluateReleaseEligibility({
      ...BASE_PARAMS,
      repository,
      observeGitRef,
      observePackageVersion,
    });

    // Assert
    expect(result).toEqual({ eligible: false, reason: "release_branch_conflict", releaseBranch: `release/${VERSION}` });
  });

  it("fails closed with release_tag_observation_error when the tag ref lookup errors", async () => {
    // Arrange
    const repository = fakeRepository(validIntentDocument);
    const observeGitRef: ObserveGitRefSha = vi.fn(async ({ ref }) => {
      if (ref === `heads/${SOURCE_BRANCH}`) return { ok: true, found: true, sha: SOURCE_REVISION };
      if (ref === `heads/release/${VERSION}`) return { ok: true, found: false };
      return { ok: false, reason: "ref_lookup_network_error" };
    });
    const observePackageVersion = fakeObservePackageVersion({ [SOURCE_REVISION]: { found: true, version: "0.1.0" } });

    // Act
    const result = await evaluateReleaseEligibility({
      ...BASE_PARAMS,
      repository,
      observeGitRef,
      observePackageVersion,
    });

    // Assert
    expect(result).toEqual({ eligible: false, reason: "release_tag_observation_error" });
  });

  it("fails closed with release_tag_conflict when v<version> already exists, always, never idempotently", async () => {
    // Arrange
    const repository = fakeRepository(validIntentDocument);
    const observeGitRef = fakeObserveGitRef({
      [`heads/${SOURCE_BRANCH}`]: { found: true, sha: SOURCE_REVISION },
      [`heads/release/${VERSION}`]: { found: false },
      [`tags/v${VERSION}`]: { found: true, sha: "d".repeat(40) },
    });
    const observePackageVersion = fakeObservePackageVersion({ [SOURCE_REVISION]: { found: true, version: "0.1.0" } });

    // Act
    const result = await evaluateReleaseEligibility({
      ...BASE_PARAMS,
      repository,
      observeGitRef,
      observePackageVersion,
    });

    // Assert
    expect(result).toEqual({ eligible: false, reason: "release_tag_conflict", tag: `v${VERSION}` });
  });
});
