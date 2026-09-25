import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, it, vi } from "vitest";

import { evaluateReleaseEligibility } from "./releaseEligibility";

import type { ReleaseIntentRepository } from "./releaseIntentRepository";
import type { ObserveCommit, ObserveFileContent, ObserveGitRefSha, ObservePackageVersion } from "./releaseRepositoryObservation";

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

const RELEASE_COMMIT_MESSAGE = `chore(release): prepare v${VERSION}`;

const BEFORE_PACKAGE_JSON = { name: "kanban-app", version: "0.1.0" };
const BEFORE_LOCKFILE = { name: "kanban-app", version: "0.1.0", packages: { "": { name: "kanban-app", version: "0.1.0" } } };
const AFTER_PACKAGE_JSON = { name: "kanban-app", version: VERSION };
const AFTER_LOCKFILE = { name: "kanban-app", version: VERSION, packages: { "": { name: "kanban-app", version: VERSION } } };

function fakeObserveCommit(bySha: Record<string, Awaited<ReturnType<ObserveCommit>>>): ObserveCommit {
  return vi.fn(async ({ sha }) => {
    const entry = bySha[sha];
    if (!entry) {
      throw new Error(`unexpected commit lookup: ${sha}`);
    }
    return entry;
  });
}

function validRecoveryCommitObservation(sha: string): Awaited<ReturnType<ObserveCommit>> {
  return {
    ok: true,
    found: true,
    commit: { sha, message: RELEASE_COMMIT_MESSAGE, parentShas: [SOURCE_REVISION], changedFiles: ["package-lock.json", "package.json"] },
  };
}

function fakeObserveFileContent(byKey: Record<string, Awaited<ReturnType<ObserveFileContent>>>): ObserveFileContent {
  return vi.fn(async ({ ref, path }) => {
    const key = `${ref}:${path}`;
    const entry = byKey[key];
    if (!entry) {
      throw new Error(`unexpected file content lookup: ${key}`);
    }
    return entry;
  });
}

function validRecoveryFileContentObservations(): Record<string, Awaited<ReturnType<ObserveFileContent>>> {
  return {
    [`${SOURCE_REVISION}:package.json`]: { ok: true, found: true, content: JSON.stringify(BEFORE_PACKAGE_JSON) },
    [`${SOURCE_REVISION}:package-lock.json`]: { ok: true, found: true, content: JSON.stringify(BEFORE_LOCKFILE) },
    [`${RELEASE_BRANCH_SHA}:package.json`]: { ok: true, found: true, content: JSON.stringify(AFTER_PACKAGE_JSON) },
    [`${RELEASE_BRANCH_SHA}:package-lock.json`]: { ok: true, found: true, content: JSON.stringify(AFTER_LOCKFILE) },
  };
}

const BASE_PARAMS = {
  releaseIntentId: RELEASE_INTENT_ID,
  expectedRepository: REPOSITORY,
  expectedSourceBranch: SOURCE_BRANCH,
  observeCommit: vi.fn() as ObserveCommit,
  observeFileContent: vi.fn() as ObserveFileContent,
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

  describe("already_started recovery reconciliation", () => {
    function baseAlreadyStartedParams() {
      const repository = fakeRepository(validIntentDocument);
      const observeGitRef = fakeObserveGitRef({
        [`heads/${SOURCE_BRANCH}`]: { found: true, sha: SOURCE_REVISION },
        [`heads/release/${VERSION}`]: { found: true, sha: RELEASE_BRANCH_SHA },
      });
      const observePackageVersion = fakeObservePackageVersion({
        [SOURCE_REVISION]: { found: true, version: "0.1.0" },
        [RELEASE_BRANCH_SHA]: { found: true, version: VERSION },
      });
      return { repository, observeGitRef, observePackageVersion };
    }

    it("reports already_started with the full trusted recovered identity when every reconciliation check agrees", async () => {
      // Arrange
      const { repository, observeGitRef, observePackageVersion } = baseAlreadyStartedParams();
      const observeCommit = fakeObserveCommit({ [RELEASE_BRANCH_SHA]: validRecoveryCommitObservation(RELEASE_BRANCH_SHA) });
      const observeFileContent = fakeObserveFileContent(validRecoveryFileContentObservations());

      // Act
      const result = await evaluateReleaseEligibility({
        ...BASE_PARAMS,
        repository,
        observeGitRef,
        observePackageVersion,
        observeCommit,
        observeFileContent,
      });

      // Assert
      expect(result).toEqual({
        eligible: false,
        reason: "already_started",
        releaseIntentId: RELEASE_INTENT_ID,
        repository: REPOSITORY,
        version: VERSION,
        sourceBranch: SOURCE_BRANCH,
        sourceRevision: SOURCE_REVISION,
        releaseBranch: `release/${VERSION}`,
        releaseCommitSha: RELEASE_BRANCH_SHA,
      });
    });

    it("fails closed with release_branch_recovery_commit_observation_error when the commit cannot be observed", async () => {
      // Arrange
      const { repository, observeGitRef, observePackageVersion } = baseAlreadyStartedParams();
      const observeCommit: ObserveCommit = vi.fn(async () => ({ ok: false, reason: "commit_lookup_network_error" }));
      const observeFileContent = fakeObserveFileContent(validRecoveryFileContentObservations());

      // Act
      const result = await evaluateReleaseEligibility({
        ...BASE_PARAMS,
        repository,
        observeGitRef,
        observePackageVersion,
        observeCommit,
        observeFileContent,
      });

      // Assert
      expect(result).toEqual({ eligible: false, reason: "release_branch_recovery_commit_observation_error", releaseBranch: `release/${VERSION}` });
    });

    it("fails closed with release_branch_recovery_commit_observation_error when the commit is not found", async () => {
      // Arrange
      const { repository, observeGitRef, observePackageVersion } = baseAlreadyStartedParams();
      const observeCommit: ObserveCommit = vi.fn(async () => ({ ok: true, found: false }));
      const observeFileContent = fakeObserveFileContent(validRecoveryFileContentObservations());

      // Act
      const result = await evaluateReleaseEligibility({
        ...BASE_PARAMS,
        repository,
        observeGitRef,
        observePackageVersion,
        observeCommit,
        observeFileContent,
      });

      // Assert
      expect(result).toEqual({ eligible: false, reason: "release_branch_recovery_commit_observation_error", releaseBranch: `release/${VERSION}` });
    });

    it("fails closed with release_branch_recovery_parent_mismatch when the commit's direct parent is not the trusted sourceRevision", async () => {
      // Arrange — a manually created branch off a different, unrelated base.
      const { repository, observeGitRef, observePackageVersion } = baseAlreadyStartedParams();
      const observeCommit = fakeObserveCommit({
        [RELEASE_BRANCH_SHA]: {
          ok: true,
          found: true,
          commit: { sha: RELEASE_BRANCH_SHA, message: RELEASE_COMMIT_MESSAGE, parentShas: [OTHER_REVISION], changedFiles: ["package-lock.json", "package.json"] },
        },
      });
      const observeFileContent = fakeObserveFileContent(validRecoveryFileContentObservations());

      // Act
      const result = await evaluateReleaseEligibility({
        ...BASE_PARAMS,
        repository,
        observeGitRef,
        observePackageVersion,
        observeCommit,
        observeFileContent,
      });

      // Assert
      expect(result).toEqual({ eligible: false, reason: "release_branch_recovery_parent_mismatch", releaseBranch: `release/${VERSION}` });
    });

    it("fails closed with release_branch_recovery_message_mismatch when the commit message is not the deterministic release-start message", async () => {
      // Arrange
      const { repository, observeGitRef, observePackageVersion } = baseAlreadyStartedParams();
      const observeCommit = fakeObserveCommit({
        [RELEASE_BRANCH_SHA]: {
          ok: true,
          found: true,
          commit: { sha: RELEASE_BRANCH_SHA, message: "manual bump", parentShas: [SOURCE_REVISION], changedFiles: ["package-lock.json", "package.json"] },
        },
      });
      const observeFileContent = fakeObserveFileContent(validRecoveryFileContentObservations());

      // Act
      const result = await evaluateReleaseEligibility({
        ...BASE_PARAMS,
        repository,
        observeGitRef,
        observePackageVersion,
        observeCommit,
        observeFileContent,
      });

      // Assert
      expect(result).toEqual({ eligible: false, reason: "release_branch_recovery_message_mismatch", releaseBranch: `release/${VERSION}` });
    });

    it("fails closed with release_branch_recovery_changed_files_mismatch when the commit touched an unexpected file", async () => {
      // Arrange
      const { repository, observeGitRef, observePackageVersion } = baseAlreadyStartedParams();
      const observeCommit = fakeObserveCommit({
        [RELEASE_BRANCH_SHA]: {
          ok: true,
          found: true,
          commit: { sha: RELEASE_BRANCH_SHA, message: RELEASE_COMMIT_MESSAGE, parentShas: [SOURCE_REVISION], changedFiles: ["package.json", "README.md"] },
        },
      });
      const observeFileContent = fakeObserveFileContent(validRecoveryFileContentObservations());

      // Act
      const result = await evaluateReleaseEligibility({
        ...BASE_PARAMS,
        repository,
        observeGitRef,
        observePackageVersion,
        observeCommit,
        observeFileContent,
      });

      // Assert
      expect(result).toEqual({ eligible: false, reason: "release_branch_recovery_changed_files_mismatch", releaseBranch: `release/${VERSION}` });
    });

    it("fails closed with release_branch_recovery_content_observation_error when fetching package.json/lockfile content fails", async () => {
      // Arrange
      const { repository, observeGitRef, observePackageVersion } = baseAlreadyStartedParams();
      const observeCommit = fakeObserveCommit({ [RELEASE_BRANCH_SHA]: validRecoveryCommitObservation(RELEASE_BRANCH_SHA) });
      const observeFileContent: ObserveFileContent = vi.fn(async () => ({ ok: false, reason: "file_lookup_network_error" }));

      // Act
      const result = await evaluateReleaseEligibility({
        ...BASE_PARAMS,
        repository,
        observeGitRef,
        observePackageVersion,
        observeCommit,
        observeFileContent,
      });

      // Assert
      expect(result).toEqual({ eligible: false, reason: "release_branch_recovery_content_observation_error", releaseBranch: `release/${VERSION}` });
    });

    it("fails closed with release_branch_recovery_lockfile_version_mismatch when the lockfile root version disagrees with the requested version", async () => {
      // Arrange
      const { repository, observeGitRef, observePackageVersion } = baseAlreadyStartedParams();
      const observeCommit = fakeObserveCommit({ [RELEASE_BRANCH_SHA]: validRecoveryCommitObservation(RELEASE_BRANCH_SHA) });
      const observations = validRecoveryFileContentObservations();
      observations[`${RELEASE_BRANCH_SHA}:package-lock.json`] = {
        ok: true,
        found: true,
        content: JSON.stringify({ name: "kanban-app", version: "0.1.0", packages: { "": { name: "kanban-app", version: "0.1.0" } } }),
      };
      const observeFileContent = fakeObserveFileContent(observations);

      // Act
      const result = await evaluateReleaseEligibility({
        ...BASE_PARAMS,
        repository,
        observeGitRef,
        observePackageVersion,
        observeCommit,
        observeFileContent,
      });

      // Assert
      expect(result).toEqual({ eligible: false, reason: "release_branch_recovery_lockfile_version_mismatch", releaseBranch: `release/${VERSION}` });
    });

    it("fails closed with release_branch_recovery_unrelated_change when package.json changed an unrelated field beyond the version bump", async () => {
      // Arrange
      const { repository, observeGitRef, observePackageVersion } = baseAlreadyStartedParams();
      const observeCommit = fakeObserveCommit({ [RELEASE_BRANCH_SHA]: validRecoveryCommitObservation(RELEASE_BRANCH_SHA) });
      const observations = validRecoveryFileContentObservations();
      observations[`${RELEASE_BRANCH_SHA}:package.json`] = {
        ok: true,
        found: true,
        content: JSON.stringify({ name: "kanban-app-renamed", version: VERSION }),
      };
      const observeFileContent = fakeObserveFileContent(observations);

      // Act
      const result = await evaluateReleaseEligibility({
        ...BASE_PARAMS,
        repository,
        observeGitRef,
        observePackageVersion,
        observeCommit,
        observeFileContent,
      });

      // Assert
      expect(result).toEqual({ eligible: false, reason: "release_branch_recovery_unrelated_change", releaseBranch: `release/${VERSION}` });
    });

    it("fails closed with release_branch_recovery_content_observation_error, never throwing, when the sourceRevision's lockfile lacks the expected packages[\"\"] shape", async () => {
      // Arrange — a real-world repo whose pre-release lockfile predates root-package tracking.
      const { repository, observeGitRef, observePackageVersion } = baseAlreadyStartedParams();
      const observeCommit = fakeObserveCommit({ [RELEASE_BRANCH_SHA]: validRecoveryCommitObservation(RELEASE_BRANCH_SHA) });
      const observations = validRecoveryFileContentObservations();
      observations[`${SOURCE_REVISION}:package-lock.json`] = {
        ok: true,
        found: true,
        content: JSON.stringify({ name: "kanban-app", version: "0.1.0" }),
      };
      const observeFileContent = fakeObserveFileContent(observations);

      // Act
      const result = await evaluateReleaseEligibility({
        ...BASE_PARAMS,
        repository,
        observeGitRef,
        observePackageVersion,
        observeCommit,
        observeFileContent,
      });

      // Assert
      expect(result).toEqual({ eligible: false, reason: "release_branch_recovery_content_observation_error", releaseBranch: `release/${VERSION}` });
    });

    it("fails closed with release_branch_recovery_unrelated_change when package-lock.json changed an unrelated field beyond the version bump", async () => {
      // Arrange
      const { repository, observeGitRef, observePackageVersion } = baseAlreadyStartedParams();
      const observeCommit = fakeObserveCommit({ [RELEASE_BRANCH_SHA]: validRecoveryCommitObservation(RELEASE_BRANCH_SHA) });
      const observations = validRecoveryFileContentObservations();
      observations[`${RELEASE_BRANCH_SHA}:package-lock.json`] = {
        ok: true,
        found: true,
        content: JSON.stringify({
          name: "kanban-app",
          version: VERSION,
          packages: { "": { name: "kanban-app", version: VERSION }, "node_modules/extra": { version: "9.9.9" } },
        }),
      };
      const observeFileContent = fakeObserveFileContent(observations);

      // Act
      const result = await evaluateReleaseEligibility({
        ...BASE_PARAMS,
        repository,
        observeGitRef,
        observePackageVersion,
        observeCommit,
        observeFileContent,
      });

      // Assert
      expect(result).toEqual({ eligible: false, reason: "release_branch_recovery_unrelated_change", releaseBranch: `release/${VERSION}` });
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
