import { randomUUID } from "node:crypto";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { Timestamp, getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createFirestoreReleaseIntentRepository } from "./releaseIntentRepository";

const firestoreEmulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const describeWithEmulator = firestoreEmulatorHost ? describe : describe.skip;

describeWithEmulator("createFirestoreReleaseIntentRepository() against the Firestore emulator", () => {
  const projectId = process.env.GCLOUD_PROJECT ?? "demo-kanban-app-test";
  const app = initializeApp({ projectId }, `executor-release-intent-repository-integration-${randomUUID()}`);
  const firestore = getFirestore(app);
  const repositoryField = "johnpwise/kanban-app";
  const sourceBranch = "develop";
  const sourceRevision = "a".repeat(40);
  const otherSourceRevision = "b".repeat(40);

  beforeAll(() => {
    expect(firestoreEmulatorHost).toMatch(/^127\.0\.0\.1:\d+$/);
  });

  afterAll(async () => {
    await deleteApp(app);
  });

  function uniqueVersion(): string {
    // Keep it a plain MAJOR.MINOR.PATCH while remaining unique per test run.
    return `0.${Math.floor(Math.random() * 1_000_000)}.0`;
  }

  it("records a release intent that has no existing document at its derived id", async () => {
    // Arrange
    const version = uniqueVersion();
    const releaseIntentId = `johnpwise__kanban-app--${version}`;
    const docRef = firestore.collection("releaseIntents").doc(releaseIntentId);
    const repository = createFirestoreReleaseIntentRepository();

    // Act
    const outcome = await repository.recordReleaseIntent(releaseIntentId, {
      repository: repositoryField,
      version,
      sourceBranch,
      sourceRevision,
    });

    // Assert
    expect(outcome).toEqual({ outcome: "created" });
    const data = (await docRef.get()).data();
    expect(data?.releaseIntentId).toBe(releaseIntentId);
    expect(data?.repository).toBe(repositoryField);
    expect(data?.version).toBe(version);
    expect(data?.sourceBranch).toBe(sourceBranch);
    expect(data?.sourceRevision).toBe(sourceRevision);
    expect(data?.requestedAt).toBeInstanceOf(Timestamp);
  });

  it("idempotently accepts recording the exact same identity that is already persisted", async () => {
    // Arrange
    const version = uniqueVersion();
    const releaseIntentId = `johnpwise__kanban-app--${version}`;
    const docRef = firestore.collection("releaseIntents").doc(releaseIntentId);
    const repository = createFirestoreReleaseIntentRepository();
    const identity = { repository: repositoryField, version, sourceBranch, sourceRevision };
    await repository.recordReleaseIntent(releaseIntentId, identity);
    const firstRequestedAt = (await docRef.get()).data()?.requestedAt;

    // Act
    const outcome = await repository.recordReleaseIntent(releaseIntentId, identity);

    // Assert
    expect(outcome).toEqual({ outcome: "already_recorded" });
    const data = (await docRef.get()).data();
    expect(data?.requestedAt).toEqual(firstRequestedAt);
  });

  it("refuses to overwrite a conflicting already-persisted source revision for the same id", async () => {
    // Arrange
    const version = uniqueVersion();
    const releaseIntentId = `johnpwise__kanban-app--${version}`;
    const docRef = firestore.collection("releaseIntents").doc(releaseIntentId);
    const repository = createFirestoreReleaseIntentRepository();
    await repository.recordReleaseIntent(releaseIntentId, { repository: repositoryField, version, sourceBranch, sourceRevision });

    // Act
    const outcome = await repository.recordReleaseIntent(releaseIntentId, {
      repository: repositoryField,
      version,
      sourceBranch,
      sourceRevision: otherSourceRevision,
    });

    // Assert
    expect(outcome).toEqual({ outcome: "conflict" });
    const data = (await docRef.get()).data();
    expect(data?.sourceRevision).toBe(sourceRevision);
  });

  it("refuses to overwrite a conflicting already-persisted source branch for the same id", async () => {
    // Arrange
    const version = uniqueVersion();
    const releaseIntentId = `johnpwise__kanban-app--${version}`;
    const docRef = firestore.collection("releaseIntents").doc(releaseIntentId);
    const repository = createFirestoreReleaseIntentRepository();
    await repository.recordReleaseIntent(releaseIntentId, { repository: repositoryField, version, sourceBranch, sourceRevision });

    // Act
    const outcome = await repository.recordReleaseIntent(releaseIntentId, {
      repository: repositoryField,
      version,
      sourceBranch: "main",
      sourceRevision,
    });

    // Assert
    expect(outcome).toEqual({ outcome: "conflict" });
    const data = (await docRef.get()).data();
    expect(data?.sourceBranch).toBe(sourceBranch);
  });

  it("loads previously recorded release intent data by its derived id, and undefined for a non-existent one", async () => {
    // Arrange
    const version = uniqueVersion();
    const releaseIntentId = `johnpwise__kanban-app--${version}`;
    const repository = createFirestoreReleaseIntentRepository();
    await repository.recordReleaseIntent(releaseIntentId, { repository: repositoryField, version, sourceBranch, sourceRevision });

    // Act
    const loaded = await repository.loadReleaseIntentData(releaseIntentId);
    const missing = await repository.loadReleaseIntentData(`johnpwise__kanban-app--9.9.9-${randomUUID()}`);

    // Assert
    expect((loaded as { version?: unknown } | undefined)?.version).toBe(version);
    expect(missing).toBeUndefined();
  });

  it("given many concurrent recordings of the same identity, exactly one create is persisted and the rest are idempotent", async () => {
    // Arrange
    const version = uniqueVersion();
    const releaseIntentId = `johnpwise__kanban-app--${version}`;
    const docRef = firestore.collection("releaseIntents").doc(releaseIntentId);
    const repository = createFirestoreReleaseIntentRepository();
    const identity = { repository: repositoryField, version, sourceBranch, sourceRevision };
    const attemptCount = 5;

    // Act
    const outcomes = await Promise.all(
      Array.from({ length: attemptCount }, () => repository.recordReleaseIntent(releaseIntentId, identity)),
    );

    // Assert
    expect(outcomes.filter((outcome) => outcome.outcome === "created")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.outcome === "already_recorded")).toHaveLength(attemptCount - 1);
    const data = (await docRef.get()).data();
    expect(data?.sourceRevision).toBe(sourceRevision);
  });

  describe("recordReleaseStartResult()", () => {
    const releaseBranch = (version: string) => `release/${version}`;
    const commitSha = "c".repeat(40);
    const otherCommitSha = "d".repeat(40);

    async function seedReleaseIntent(): Promise<{ releaseIntentId: string; version: string }> {
      const version = uniqueVersion();
      const releaseIntentId = `johnpwise__kanban-app--${version}`;
      const repository = createFirestoreReleaseIntentRepository();
      await repository.recordReleaseIntent(releaseIntentId, { repository: repositoryField, version, sourceBranch, sourceRevision });
      return { releaseIntentId, version };
    }

    function trustedIdentity(version: string, overrides: Partial<{ releaseBranch: string; commitSha: string; sourceBranch: string; sourceRevision: string; version: string; repository: string }> = {}) {
      return {
        repository: repositoryField,
        version,
        sourceBranch,
        sourceRevision,
        releaseBranch: releaseBranch(version),
        commitSha,
        ...overrides,
      };
    }

    it("records the first trusted release-start result against an existing release intent", async () => {
      // Arrange
      const { releaseIntentId, version } = await seedReleaseIntent();
      const docRef = firestore.collection("releaseIntents").doc(releaseIntentId);
      const repository = createFirestoreReleaseIntentRepository();

      // Act
      const outcome = await repository.recordReleaseStartResult(releaseIntentId, trustedIdentity(version));

      // Assert
      expect(outcome).toEqual({ outcome: "created" });
      const data = (await docRef.get()).data();
      expect(data?.start?.releaseBranch).toBe(releaseBranch(version));
      expect(data?.start?.commitSha).toBe(commitSha);
      expect(data?.start?.recordedAt).toBeInstanceOf(Timestamp);
    });

    it("idempotently accepts recording the exact same trusted identity that is already persisted", async () => {
      // Arrange
      const { releaseIntentId, version } = await seedReleaseIntent();
      const docRef = firestore.collection("releaseIntents").doc(releaseIntentId);
      const repository = createFirestoreReleaseIntentRepository();
      await repository.recordReleaseStartResult(releaseIntentId, trustedIdentity(version));
      const firstRecordedAt = (await docRef.get()).data()?.start?.recordedAt;

      // Act
      const outcome = await repository.recordReleaseStartResult(releaseIntentId, trustedIdentity(version));

      // Assert
      expect(outcome).toEqual({ outcome: "already_recorded" });
      const data = (await docRef.get()).data();
      expect(data?.start?.recordedAt).toEqual(firstRecordedAt);
    });

    it("refuses to overwrite an already-recorded result with a different release branch", async () => {
      // Arrange
      const { releaseIntentId, version } = await seedReleaseIntent();
      const docRef = firestore.collection("releaseIntents").doc(releaseIntentId);
      const repository = createFirestoreReleaseIntentRepository();
      await repository.recordReleaseStartResult(releaseIntentId, trustedIdentity(version));

      // Act
      const outcome = await repository.recordReleaseStartResult(releaseIntentId, trustedIdentity(version, { releaseBranch: "release/other" }));

      // Assert
      expect(outcome).toEqual({ outcome: "conflict" });
      const data = (await docRef.get()).data();
      expect(data?.start?.releaseBranch).toBe(releaseBranch(version));
    });

    it("refuses to overwrite an already-recorded result with a different commit SHA", async () => {
      // Arrange
      const { releaseIntentId, version } = await seedReleaseIntent();
      const docRef = firestore.collection("releaseIntents").doc(releaseIntentId);
      const repository = createFirestoreReleaseIntentRepository();
      await repository.recordReleaseStartResult(releaseIntentId, trustedIdentity(version));

      // Act
      const outcome = await repository.recordReleaseStartResult(releaseIntentId, trustedIdentity(version, { commitSha: otherCommitSha }));

      // Assert
      expect(outcome).toEqual({ outcome: "conflict" });
      const data = (await docRef.get()).data();
      expect(data?.start?.commitSha).toBe(commitSha);
    });

    it("fails closed with release_intent_not_found when no such release intent exists", async () => {
      // Arrange
      const repository = createFirestoreReleaseIntentRepository();
      const missingId = `johnpwise__kanban-app--9.9.9-${randomUUID()}`;

      // Act
      const outcome = await repository.recordReleaseStartResult(missingId, trustedIdentity("9.9.9"));

      // Assert
      expect(outcome).toEqual({ outcome: "release_intent_not_found" });
    });

    it("fails closed with release_intent_invalid when the persisted document fails schema validation", async () => {
      // Arrange
      const version = uniqueVersion();
      const releaseIntentId = `johnpwise__kanban-app--${version}`;
      await firestore.collection("releaseIntents").doc(releaseIntentId).set({
        releaseIntentId,
        repository: repositoryField,
        version: "v-not-a-version",
        sourceBranch,
        sourceRevision,
        requestedAt: Timestamp.now(),
      });
      const repository = createFirestoreReleaseIntentRepository();

      // Act
      const outcome = await repository.recordReleaseStartResult(releaseIntentId, trustedIdentity(version));

      // Assert
      expect(outcome).toEqual({ outcome: "release_intent_invalid" });
    });

    it("fails closed with release_intent_identity_mismatch when the supplied identity disagrees with the persisted immutable intent", async () => {
      // Arrange
      const { releaseIntentId, version } = await seedReleaseIntent();
      const repository = createFirestoreReleaseIntentRepository();

      // Act
      const outcome = await repository.recordReleaseStartResult(releaseIntentId, trustedIdentity(version, { sourceRevision: otherSourceRevision }));

      // Assert
      expect(outcome).toEqual({ outcome: "release_intent_identity_mismatch" });
      const data = (await firestore.collection("releaseIntents").doc(releaseIntentId).get()).data();
      expect(data?.start).toBeUndefined();
    });

    it("given many concurrent recordings of the same trusted identity, exactly one create is persisted and the rest converge idempotently", async () => {
      // Arrange
      const { releaseIntentId, version } = await seedReleaseIntent();
      const docRef = firestore.collection("releaseIntents").doc(releaseIntentId);
      const repository = createFirestoreReleaseIntentRepository();
      const identity = trustedIdentity(version);
      const attemptCount = 5;

      // Act
      const outcomes = await Promise.all(
        Array.from({ length: attemptCount }, () => repository.recordReleaseStartResult(releaseIntentId, identity)),
      );

      // Assert
      expect(outcomes.filter((outcome) => outcome.outcome === "created")).toHaveLength(1);
      expect(outcomes.filter((outcome) => outcome.outcome === "already_recorded")).toHaveLength(attemptCount - 1);
      const data = (await docRef.get()).data();
      expect(data?.start?.commitSha).toBe(commitSha);
    });
  });

  describe("recordReleasePullRequestResult()", () => {
    const releaseBranch = (version: string) => `release/${version}`;
    const commitSha = "e".repeat(40);
    const otherCommitSha = "f".repeat(40);

    async function seedReleaseIntentWithStart(): Promise<{ releaseIntentId: string; version: string }> {
      const version = uniqueVersion();
      const releaseIntentId = `johnpwise__kanban-app--${version}`;
      const repository = createFirestoreReleaseIntentRepository();
      await repository.recordReleaseIntent(releaseIntentId, { repository: repositoryField, version, sourceBranch, sourceRevision });
      await repository.recordReleaseStartResult(releaseIntentId, {
        repository: repositoryField,
        version,
        sourceBranch,
        sourceRevision,
        releaseBranch: releaseBranch(version),
        commitSha,
      });
      return { releaseIntentId, version };
    }

    function trustedPullRequestIdentity(
      version: string,
      overrides: Partial<{
        target: "main" | "develop";
        releaseBranch: string;
        commitSha: string;
        sourceBranch: string;
        sourceRevision: string;
        version: string;
        repository: string;
        number: number;
      }> = {},
    ) {
      return {
        repository: repositoryField,
        version,
        sourceBranch,
        sourceRevision,
        releaseBranch: releaseBranch(version),
        commitSha,
        target: "main" as const,
        number: 101,
        ...overrides,
      };
    }

    it("records the first trusted release pull request result for a target against a started release intent", async () => {
      // Arrange
      const { releaseIntentId, version } = await seedReleaseIntentWithStart();
      const docRef = firestore.collection("releaseIntents").doc(releaseIntentId);
      const repository = createFirestoreReleaseIntentRepository();

      // Act
      const outcome = await repository.recordReleasePullRequestResult(releaseIntentId, trustedPullRequestIdentity(version));

      // Assert
      expect(outcome).toEqual({ outcome: "created" });
      const data = (await docRef.get()).data();
      expect(data?.pullRequests?.main?.number).toBe(101);
      expect(data?.pullRequests?.main?.baseBranch).toBe("main");
      expect(data?.pullRequests?.main?.headBranch).toBe(releaseBranch(version));
      expect(data?.pullRequests?.main?.headSha).toBe(commitSha);
      expect(data?.pullRequests?.main?.recordedAt).toBeInstanceOf(Timestamp);
      expect(data?.pullRequests?.develop).toBeUndefined();
    });

    it("records the develop target independently of the main target", async () => {
      // Arrange
      const { releaseIntentId, version } = await seedReleaseIntentWithStart();
      const docRef = firestore.collection("releaseIntents").doc(releaseIntentId);
      const repository = createFirestoreReleaseIntentRepository();
      await repository.recordReleasePullRequestResult(releaseIntentId, trustedPullRequestIdentity(version, { target: "main", number: 101 }));

      // Act
      const outcome = await repository.recordReleasePullRequestResult(
        releaseIntentId,
        trustedPullRequestIdentity(version, { target: "develop", number: 102 }),
      );

      // Assert
      expect(outcome).toEqual({ outcome: "created" });
      const data = (await docRef.get()).data();
      expect(data?.pullRequests?.main?.number).toBe(101);
      expect(data?.pullRequests?.develop?.number).toBe(102);
      expect(data?.pullRequests?.develop?.baseBranch).toBe("develop");
    });

    it("idempotently accepts recording the exact same trusted pull request identity that is already persisted", async () => {
      // Arrange
      const { releaseIntentId, version } = await seedReleaseIntentWithStart();
      const docRef = firestore.collection("releaseIntents").doc(releaseIntentId);
      const repository = createFirestoreReleaseIntentRepository();
      const identity = trustedPullRequestIdentity(version);
      await repository.recordReleasePullRequestResult(releaseIntentId, identity);
      const firstRecordedAt = (await docRef.get()).data()?.pullRequests?.main?.recordedAt;

      // Act
      const outcome = await repository.recordReleasePullRequestResult(releaseIntentId, identity);

      // Assert
      expect(outcome).toEqual({ outcome: "already_recorded" });
      const data = (await docRef.get()).data();
      expect(data?.pullRequests?.main?.recordedAt).toEqual(firstRecordedAt);
    });

    it("refuses to overwrite an already-recorded pull request result with a different PR number for the same target", async () => {
      // Arrange
      const { releaseIntentId, version } = await seedReleaseIntentWithStart();
      const docRef = firestore.collection("releaseIntents").doc(releaseIntentId);
      const repository = createFirestoreReleaseIntentRepository();
      await repository.recordReleasePullRequestResult(releaseIntentId, trustedPullRequestIdentity(version));

      // Act
      const outcome = await repository.recordReleasePullRequestResult(releaseIntentId, trustedPullRequestIdentity(version, { number: 999 }));

      // Assert
      expect(outcome).toEqual({ outcome: "conflict" });
      const data = (await docRef.get()).data();
      expect(data?.pullRequests?.main?.number).toBe(101);
    });

    it("fails closed with release_intent_not_found when no such release intent exists", async () => {
      // Arrange
      const repository = createFirestoreReleaseIntentRepository();
      const missingId = `johnpwise__kanban-app--9.9.9-${randomUUID()}`;

      // Act
      const outcome = await repository.recordReleasePullRequestResult(missingId, trustedPullRequestIdentity("9.9.9"));

      // Assert
      expect(outcome).toEqual({ outcome: "release_intent_not_found" });
    });

    it("fails closed with release_intent_invalid when the persisted document fails schema validation", async () => {
      // Arrange
      const version = uniqueVersion();
      const releaseIntentId = `johnpwise__kanban-app--${version}`;
      await firestore.collection("releaseIntents").doc(releaseIntentId).set({
        releaseIntentId,
        repository: repositoryField,
        version: "v-not-a-version",
        sourceBranch,
        sourceRevision,
        requestedAt: Timestamp.now(),
      });
      const repository = createFirestoreReleaseIntentRepository();

      // Act
      const outcome = await repository.recordReleasePullRequestResult(releaseIntentId, trustedPullRequestIdentity(version));

      // Assert
      expect(outcome).toEqual({ outcome: "release_intent_invalid" });
    });

    it("fails closed with release_intent_identity_mismatch when the supplied identity disagrees with the persisted immutable intent", async () => {
      // Arrange
      const { releaseIntentId, version } = await seedReleaseIntentWithStart();
      const repository = createFirestoreReleaseIntentRepository();

      // Act
      const outcome = await repository.recordReleasePullRequestResult(
        releaseIntentId,
        trustedPullRequestIdentity(version, { sourceRevision: otherSourceRevision }),
      );

      // Assert
      expect(outcome).toEqual({ outcome: "release_intent_identity_mismatch" });
      const data = (await firestore.collection("releaseIntents").doc(releaseIntentId).get()).data();
      expect(data?.pullRequests).toBeUndefined();
    });

    it("fails closed with release_start_missing when the release intent has no durable start result yet", async () => {
      // Arrange
      const version = uniqueVersion();
      const releaseIntentId = `johnpwise__kanban-app--${version}`;
      const repository = createFirestoreReleaseIntentRepository();
      await repository.recordReleaseIntent(releaseIntentId, { repository: repositoryField, version, sourceBranch, sourceRevision });

      // Act
      const outcome = await repository.recordReleasePullRequestResult(releaseIntentId, trustedPullRequestIdentity(version));

      // Assert
      expect(outcome).toEqual({ outcome: "release_start_missing" });
    });

    it("fails closed with release_start_identity_mismatch when the supplied releaseBranch/commitSha disagree with the persisted start result", async () => {
      // Arrange
      const { releaseIntentId, version } = await seedReleaseIntentWithStart();
      const repository = createFirestoreReleaseIntentRepository();

      // Act
      const outcome = await repository.recordReleasePullRequestResult(
        releaseIntentId,
        trustedPullRequestIdentity(version, { commitSha: otherCommitSha }),
      );

      // Assert
      expect(outcome).toEqual({ outcome: "release_start_identity_mismatch" });
      const data = (await firestore.collection("releaseIntents").doc(releaseIntentId).get()).data();
      expect(data?.pullRequests).toBeUndefined();
    });

    it("given many concurrent recordings of the same trusted pull request identity, exactly one create is persisted and the rest converge idempotently", async () => {
      // Arrange
      const { releaseIntentId, version } = await seedReleaseIntentWithStart();
      const docRef = firestore.collection("releaseIntents").doc(releaseIntentId);
      const repository = createFirestoreReleaseIntentRepository();
      const identity = trustedPullRequestIdentity(version);
      const attemptCount = 5;

      // Act
      const outcomes = await Promise.all(
        Array.from({ length: attemptCount }, () => repository.recordReleasePullRequestResult(releaseIntentId, identity)),
      );

      // Assert
      expect(outcomes.filter((outcome) => outcome.outcome === "created")).toHaveLength(1);
      expect(outcomes.filter((outcome) => outcome.outcome === "already_recorded")).toHaveLength(attemptCount - 1);
      const data = (await docRef.get()).data();
      expect(data?.pullRequests?.main?.number).toBe(101);
    });
  });

  describe("recordReleaseCiResult()", () => {
    const releaseBranch = (version: string) => `release/${version}`;
    const startCommitSha = "1".repeat(40);
    const mainPrNumber = 201;
    const developPrNumber = 202;

    async function seedReleaseIntentWithPullRequests(): Promise<{ releaseIntentId: string; version: string }> {
      const version = uniqueVersion();
      const releaseIntentId = `johnpwise__kanban-app--${version}`;
      const repository = createFirestoreReleaseIntentRepository();
      await repository.recordReleaseIntent(releaseIntentId, { repository: repositoryField, version, sourceBranch, sourceRevision });
      await repository.recordReleaseStartResult(releaseIntentId, {
        repository: repositoryField,
        version,
        sourceBranch,
        sourceRevision,
        releaseBranch: releaseBranch(version),
        commitSha: startCommitSha,
      });
      await repository.recordReleasePullRequestResult(releaseIntentId, {
        repository: repositoryField,
        version,
        sourceBranch,
        sourceRevision,
        releaseBranch: releaseBranch(version),
        commitSha: startCommitSha,
        target: "main",
        number: mainPrNumber,
      });
      await repository.recordReleasePullRequestResult(releaseIntentId, {
        repository: repositoryField,
        version,
        sourceBranch,
        sourceRevision,
        releaseBranch: releaseBranch(version),
        commitSha: startCommitSha,
        target: "develop",
        number: developPrNumber,
      });
      return { releaseIntentId, version };
    }

    function succeededCiIdentity(overrides: Partial<{ number: number; runId: number; htmlUrl: string }> = {}) {
      return {
        target: "main" as const,
        number: mainPrNumber,
        state: "succeeded" as const,
        runId: 501,
        htmlUrl: "https://github.com/johnpwise/kanban-app/actions/runs/501",
        ...overrides,
      };
    }

    it("records the first trusted terminal CI result (succeeded) for a target against an already-recorded pull request", async () => {
      // Arrange
      const { releaseIntentId, version } = await seedReleaseIntentWithPullRequests();
      const docRef = firestore.collection("releaseIntents").doc(releaseIntentId);
      const repository = createFirestoreReleaseIntentRepository();

      // Act
      const outcome = await repository.recordReleaseCiResult(releaseIntentId, succeededCiIdentity());

      // Assert
      expect(outcome).toEqual({ outcome: "created" });
      const data = (await docRef.get()).data();
      expect(data?.ci?.main?.number).toBe(mainPrNumber);
      expect(data?.ci?.main?.baseBranch).toBe("main");
      expect(data?.ci?.main?.headBranch).toBe(releaseBranch(version));
      expect(data?.ci?.main?.headSha).toBe(startCommitSha);
      expect(data?.ci?.main?.state).toBe("succeeded");
      expect(data?.ci?.main?.runId).toBe(501);
      expect(data?.ci?.main?.htmlUrl).toBe("https://github.com/johnpwise/kanban-app/actions/runs/501");
      expect(data?.ci?.main?.conclusion).toBeUndefined();
      expect(data?.ci?.main?.recordedAt).toBeInstanceOf(Timestamp);
      expect(data?.ci?.develop).toBeUndefined();
    });

    it("records a failed terminal CI result with its conclusion", async () => {
      // Arrange
      const { releaseIntentId } = await seedReleaseIntentWithPullRequests();
      const docRef = firestore.collection("releaseIntents").doc(releaseIntentId);
      const repository = createFirestoreReleaseIntentRepository();

      // Act
      const outcome = await repository.recordReleaseCiResult(releaseIntentId, {
        target: "develop",
        number: developPrNumber,
        state: "failed",
        runId: 601,
        htmlUrl: "https://github.com/johnpwise/kanban-app/actions/runs/601",
        conclusion: "failure",
      });

      // Assert
      expect(outcome).toEqual({ outcome: "created" });
      const data = (await docRef.get()).data();
      expect(data?.ci?.develop?.state).toBe("failed");
      expect(data?.ci?.develop?.conclusion).toBe("failure");
      expect(data?.ci?.main).toBeUndefined();
    });

    it("records the develop target independently of the main target", async () => {
      // Arrange
      const { releaseIntentId } = await seedReleaseIntentWithPullRequests();
      const docRef = firestore.collection("releaseIntents").doc(releaseIntentId);
      const repository = createFirestoreReleaseIntentRepository();
      await repository.recordReleaseCiResult(releaseIntentId, succeededCiIdentity());

      // Act
      const outcome = await repository.recordReleaseCiResult(releaseIntentId, {
        target: "develop",
        number: developPrNumber,
        state: "succeeded",
        runId: 502,
        htmlUrl: "https://github.com/johnpwise/kanban-app/actions/runs/502",
      });

      // Assert
      expect(outcome).toEqual({ outcome: "created" });
      const data = (await docRef.get()).data();
      expect(data?.ci?.main?.runId).toBe(501);
      expect(data?.ci?.develop?.runId).toBe(502);
    });

    it("idempotently accepts recording the exact same trusted CI result that is already persisted", async () => {
      // Arrange
      const { releaseIntentId } = await seedReleaseIntentWithPullRequests();
      const docRef = firestore.collection("releaseIntents").doc(releaseIntentId);
      const repository = createFirestoreReleaseIntentRepository();
      const identity = succeededCiIdentity();
      await repository.recordReleaseCiResult(releaseIntentId, identity);
      const firstRecordedAt = (await docRef.get()).data()?.ci?.main?.recordedAt;

      // Act
      const outcome = await repository.recordReleaseCiResult(releaseIntentId, identity);

      // Assert
      expect(outcome).toEqual({ outcome: "already_recorded" });
      const data = (await docRef.get()).data();
      expect(data?.ci?.main?.recordedAt).toEqual(firstRecordedAt);
    });

    it("refuses to overwrite an already-recorded CI result with a different runId (e.g. a GitHub Actions rerun)", async () => {
      // Arrange
      const { releaseIntentId } = await seedReleaseIntentWithPullRequests();
      const docRef = firestore.collection("releaseIntents").doc(releaseIntentId);
      const repository = createFirestoreReleaseIntentRepository();
      await repository.recordReleaseCiResult(releaseIntentId, succeededCiIdentity());

      // Act
      const outcome = await repository.recordReleaseCiResult(releaseIntentId, succeededCiIdentity({ runId: 999 }));

      // Assert
      expect(outcome).toEqual({ outcome: "conflict" });
      const data = (await docRef.get()).data();
      expect(data?.ci?.main?.runId).toBe(501);
    });

    it("refuses to overwrite an already-recorded succeeded result with a failed result for the same runId (rerun changed the outcome)", async () => {
      // Arrange — same runId, different state: never treated as an idempotent replay.
      const { releaseIntentId } = await seedReleaseIntentWithPullRequests();
      const docRef = firestore.collection("releaseIntents").doc(releaseIntentId);
      const repository = createFirestoreReleaseIntentRepository();
      await repository.recordReleaseCiResult(releaseIntentId, succeededCiIdentity({ runId: 700 }));

      // Act
      const outcome = await repository.recordReleaseCiResult(releaseIntentId, {
        target: "main",
        number: mainPrNumber,
        state: "failed",
        runId: 700,
        htmlUrl: "https://github.com/johnpwise/kanban-app/actions/runs/700",
        conclusion: "failure",
      });

      // Assert
      expect(outcome).toEqual({ outcome: "conflict" });
      const data = (await docRef.get()).data();
      expect(data?.ci?.main?.state).toBe("succeeded");
    });

    it("fails closed with release_intent_not_found when no such release intent exists", async () => {
      // Arrange
      const repository = createFirestoreReleaseIntentRepository();
      const missingId = `johnpwise__kanban-app--9.9.9-${randomUUID()}`;

      // Act
      const outcome = await repository.recordReleaseCiResult(missingId, succeededCiIdentity());

      // Assert
      expect(outcome).toEqual({ outcome: "release_intent_not_found" });
    });

    it("fails closed with release_intent_invalid when the persisted document fails schema validation", async () => {
      // Arrange
      const version = uniqueVersion();
      const releaseIntentId = `johnpwise__kanban-app--${version}`;
      await firestore.collection("releaseIntents").doc(releaseIntentId).set({
        releaseIntentId,
        repository: repositoryField,
        version: "v-not-a-version",
        sourceBranch,
        sourceRevision,
        requestedAt: Timestamp.now(),
      });
      const repository = createFirestoreReleaseIntentRepository();

      // Act
      const outcome = await repository.recordReleaseCiResult(releaseIntentId, succeededCiIdentity());

      // Assert
      expect(outcome).toEqual({ outcome: "release_intent_invalid" });
    });

    it("fails closed with release_pull_request_missing when no pull request result is persisted yet for this target", async () => {
      // Arrange
      const version = uniqueVersion();
      const releaseIntentId = `johnpwise__kanban-app--${version}`;
      const repository = createFirestoreReleaseIntentRepository();
      await repository.recordReleaseIntent(releaseIntentId, { repository: repositoryField, version, sourceBranch, sourceRevision });

      // Act
      const outcome = await repository.recordReleaseCiResult(releaseIntentId, succeededCiIdentity());

      // Assert
      expect(outcome).toEqual({ outcome: "release_pull_request_missing" });
    });

    it("fails closed with release_pull_request_identity_mismatch when the persisted pull request number disagrees with the observed identity", async () => {
      // Arrange — simulates a persisted PR result recorded under a different number than the one
      // CI was actually observed against (e.g. stale caller state).
      const { releaseIntentId } = await seedReleaseIntentWithPullRequests();
      const repository = createFirestoreReleaseIntentRepository();

      // Act
      const outcome = await repository.recordReleaseCiResult(releaseIntentId, succeededCiIdentity({ number: 999999 }));

      // Assert
      expect(outcome).toEqual({ outcome: "release_pull_request_identity_mismatch" });
      const data = (await firestore.collection("releaseIntents").doc(releaseIntentId).get()).data();
      expect(data?.ci).toBeUndefined();
    });

    it("never mutates the other target's already-recorded CI result", async () => {
      // Arrange
      const { releaseIntentId } = await seedReleaseIntentWithPullRequests();
      const docRef = firestore.collection("releaseIntents").doc(releaseIntentId);
      const repository = createFirestoreReleaseIntentRepository();
      await repository.recordReleaseCiResult(releaseIntentId, succeededCiIdentity());
      const mainRecordedAtBefore = (await docRef.get()).data()?.ci?.main?.recordedAt;

      // Act — a conflicting attempt on develop must never touch main.
      await repository.recordReleaseCiResult(releaseIntentId, {
        target: "develop",
        number: developPrNumber,
        state: "succeeded",
        runId: 800,
        htmlUrl: "https://github.com/johnpwise/kanban-app/actions/runs/800",
      });
      await repository.recordReleaseCiResult(releaseIntentId, {
        target: "develop",
        number: developPrNumber,
        state: "failed",
        runId: 999,
        htmlUrl: "https://github.com/johnpwise/kanban-app/actions/runs/999",
        conclusion: "failure",
      });

      // Assert
      const data = (await docRef.get()).data();
      expect(data?.ci?.main?.recordedAt).toEqual(mainRecordedAtBefore);
      expect(data?.ci?.main?.state).toBe("succeeded");
      expect(data?.ci?.develop?.state).toBe("succeeded");
      expect(data?.ci?.develop?.runId).toBe(800);
    });

    it("given many concurrent recordings of the same trusted CI result, exactly one create is persisted and the rest converge idempotently", async () => {
      // Arrange
      const { releaseIntentId } = await seedReleaseIntentWithPullRequests();
      const docRef = firestore.collection("releaseIntents").doc(releaseIntentId);
      const repository = createFirestoreReleaseIntentRepository();
      const identity = succeededCiIdentity();
      const attemptCount = 5;

      // Act
      const outcomes = await Promise.all(
        Array.from({ length: attemptCount }, () => repository.recordReleaseCiResult(releaseIntentId, identity)),
      );

      // Assert
      expect(outcomes.filter((outcome) => outcome.outcome === "created")).toHaveLength(1);
      expect(outcomes.filter((outcome) => outcome.outcome === "already_recorded")).toHaveLength(attemptCount - 1);
      const data = (await docRef.get()).data();
      expect(data?.ci?.main?.runId).toBe(501);
    });
  });

  describe("recordReleaseMergeResult()", () => {
    const releaseBranch = (version: string) => `release/${version}`;
    const startCommitSha = "2".repeat(40);
    const mainPrNumber = 301;
    const developPrNumber = 302;

    async function seedReleaseIntentWithPullRequests(): Promise<{ releaseIntentId: string; version: string }> {
      const version = uniqueVersion();
      const releaseIntentId = `johnpwise__kanban-app--${version}`;
      const repository = createFirestoreReleaseIntentRepository();
      await repository.recordReleaseIntent(releaseIntentId, { repository: repositoryField, version, sourceBranch, sourceRevision });
      await repository.recordReleaseStartResult(releaseIntentId, {
        repository: repositoryField,
        version,
        sourceBranch,
        sourceRevision,
        releaseBranch: releaseBranch(version),
        commitSha: startCommitSha,
      });
      await repository.recordReleasePullRequestResult(releaseIntentId, {
        repository: repositoryField,
        version,
        sourceBranch,
        sourceRevision,
        releaseBranch: releaseBranch(version),
        commitSha: startCommitSha,
        target: "main",
        number: mainPrNumber,
      });
      await repository.recordReleasePullRequestResult(releaseIntentId, {
        repository: repositoryField,
        version,
        sourceBranch,
        sourceRevision,
        releaseBranch: releaseBranch(version),
        commitSha: startCommitSha,
        target: "develop",
        number: developPrNumber,
      });
      return { releaseIntentId, version };
    }

    function mainMergeIdentity(overrides: Partial<{ number: number; headSha: string; mergeCommitSha: string }> = {}) {
      return {
        target: "main" as const,
        number: mainPrNumber,
        headSha: startCommitSha,
        mergeCommitSha: "3".repeat(40),
        ...overrides,
      };
    }

    it("records the first trusted merge result for a target against an already-recorded pull request", async () => {
      // Arrange
      const { releaseIntentId, version } = await seedReleaseIntentWithPullRequests();
      const docRef = firestore.collection("releaseIntents").doc(releaseIntentId);
      const repository = createFirestoreReleaseIntentRepository();

      // Act
      const outcome = await repository.recordReleaseMergeResult(releaseIntentId, mainMergeIdentity());

      // Assert
      expect(outcome).toEqual({ outcome: "created" });
      const data = (await docRef.get()).data();
      expect(data?.merges?.main?.number).toBe(mainPrNumber);
      expect(data?.merges?.main?.baseBranch).toBe("main");
      expect(data?.merges?.main?.headBranch).toBe(releaseBranch(version));
      expect(data?.merges?.main?.headSha).toBe(startCommitSha);
      expect(data?.merges?.main?.mergeCommitSha).toBe("3".repeat(40));
      expect(data?.merges?.main?.recordedAt).toBeInstanceOf(Timestamp);
      expect(data?.merges?.develop).toBeUndefined();
    });

    it("records the develop target independently of the main target", async () => {
      // Arrange
      const { releaseIntentId } = await seedReleaseIntentWithPullRequests();
      const docRef = firestore.collection("releaseIntents").doc(releaseIntentId);
      const repository = createFirestoreReleaseIntentRepository();
      await repository.recordReleaseMergeResult(releaseIntentId, mainMergeIdentity());

      // Act
      const outcome = await repository.recordReleaseMergeResult(releaseIntentId, {
        target: "develop",
        number: developPrNumber,
        headSha: startCommitSha,
        mergeCommitSha: "4".repeat(40),
      });

      // Assert
      expect(outcome).toEqual({ outcome: "created" });
      const data = (await docRef.get()).data();
      expect(data?.merges?.main?.mergeCommitSha).toBe("3".repeat(40));
      expect(data?.merges?.develop?.mergeCommitSha).toBe("4".repeat(40));
      expect(data?.merges?.develop?.baseBranch).toBe("develop");
    });

    it("idempotently accepts recording the exact same trusted merge result that is already persisted (crash recovery convergence)", async () => {
      // Arrange
      const { releaseIntentId } = await seedReleaseIntentWithPullRequests();
      const docRef = firestore.collection("releaseIntents").doc(releaseIntentId);
      const repository = createFirestoreReleaseIntentRepository();
      const identity = mainMergeIdentity();
      await repository.recordReleaseMergeResult(releaseIntentId, identity);
      const firstRecordedAt = (await docRef.get()).data()?.merges?.main?.recordedAt;

      // Act
      const outcome = await repository.recordReleaseMergeResult(releaseIntentId, identity);

      // Assert
      expect(outcome).toEqual({ outcome: "already_recorded" });
      const data = (await docRef.get()).data();
      expect(data?.merges?.main?.recordedAt).toEqual(firstRecordedAt);
    });

    it("refuses to overwrite an already-recorded merge result with a different merge commit SHA (never replaces established merge commit identity)", async () => {
      // Arrange — same PR/head, different mergeCommitSha.
      const { releaseIntentId } = await seedReleaseIntentWithPullRequests();
      const docRef = firestore.collection("releaseIntents").doc(releaseIntentId);
      const repository = createFirestoreReleaseIntentRepository();
      await repository.recordReleaseMergeResult(releaseIntentId, mainMergeIdentity());

      // Act
      const outcome = await repository.recordReleaseMergeResult(releaseIntentId, mainMergeIdentity({ mergeCommitSha: "9".repeat(40) }));

      // Assert
      expect(outcome).toEqual({ outcome: "conflict" });
      const data = (await docRef.get()).data();
      expect(data?.merges?.main?.mergeCommitSha).toBe("3".repeat(40));
    });

    it("refuses to overwrite already-recorded merge evidence that disagrees on PR number (never adopts corrupted evidence)", async () => {
      // Arrange — directly corrupt the already-recorded evidence's `number` to simulate a
      // contradictory persisted document; a legitimate replay against the real persisted PR must
      // never silently adopt the corrupted PR number as agreement.
      const { releaseIntentId } = await seedReleaseIntentWithPullRequests();
      const docRef = firestore.collection("releaseIntents").doc(releaseIntentId);
      const repository = createFirestoreReleaseIntentRepository();
      await repository.recordReleaseMergeResult(releaseIntentId, mainMergeIdentity());
      await docRef.update({ "merges.main.number": 999999 });

      // Act
      const outcome = await repository.recordReleaseMergeResult(releaseIntentId, mainMergeIdentity());

      // Assert
      expect(outcome).toEqual({ outcome: "conflict" });
      const data = (await docRef.get()).data();
      expect(data?.merges?.main?.number).toBe(999999);
    });

    it("refuses to overwrite already-recorded merge evidence that disagrees on head SHA (never adopts corrupted evidence)", async () => {
      // Arrange
      const { releaseIntentId } = await seedReleaseIntentWithPullRequests();
      const docRef = firestore.collection("releaseIntents").doc(releaseIntentId);
      const repository = createFirestoreReleaseIntentRepository();
      await repository.recordReleaseMergeResult(releaseIntentId, mainMergeIdentity());
      await docRef.update({ "merges.main.headSha": "8".repeat(40) });

      // Act
      const outcome = await repository.recordReleaseMergeResult(releaseIntentId, mainMergeIdentity());

      // Assert
      expect(outcome).toEqual({ outcome: "conflict" });
      const data = (await docRef.get()).data();
      expect(data?.merges?.main?.headSha).toBe("8".repeat(40));
    });

    it("fails closed with release_pull_request_identity_mismatch when the supplied PR number disagrees with the currently persisted prerequisite PR", async () => {
      // Arrange — no merge evidence exists yet; the disagreement is against `pullRequests.main` itself.
      const { releaseIntentId } = await seedReleaseIntentWithPullRequests();
      const repository = createFirestoreReleaseIntentRepository();

      // Act
      const outcome = await repository.recordReleaseMergeResult(releaseIntentId, mainMergeIdentity({ number: 999999 }));

      // Assert
      expect(outcome).toEqual({ outcome: "release_pull_request_identity_mismatch" });
      const data = (await firestore.collection("releaseIntents").doc(releaseIntentId).get()).data();
      expect(data?.merges).toBeUndefined();
    });

    it("fails closed with release_pull_request_identity_mismatch when the supplied head SHA disagrees with the currently persisted prerequisite PR (execution result obtained under stale identity)", async () => {
      // Arrange — simulates the crash-race case: a trusted merge execution/eligibility result was
      // computed against a head SHA that no longer agrees with the durably persisted release PR.
      const { releaseIntentId } = await seedReleaseIntentWithPullRequests();
      const repository = createFirestoreReleaseIntentRepository();

      // Act
      const outcome = await repository.recordReleaseMergeResult(releaseIntentId, mainMergeIdentity({ headSha: "7".repeat(40) }));

      // Assert
      expect(outcome).toEqual({ outcome: "release_pull_request_identity_mismatch" });
      const data = (await firestore.collection("releaseIntents").doc(releaseIntentId).get()).data();
      expect(data?.merges).toBeUndefined();
    });

    it("fails closed with release_intent_not_found when no such release intent exists", async () => {
      // Arrange
      const repository = createFirestoreReleaseIntentRepository();
      const missingId = `johnpwise__kanban-app--9.9.9-${randomUUID()}`;

      // Act
      const outcome = await repository.recordReleaseMergeResult(missingId, mainMergeIdentity());

      // Assert
      expect(outcome).toEqual({ outcome: "release_intent_not_found" });
    });

    it("fails closed with release_intent_invalid when the persisted document fails schema validation", async () => {
      // Arrange
      const version = uniqueVersion();
      const releaseIntentId = `johnpwise__kanban-app--${version}`;
      await firestore.collection("releaseIntents").doc(releaseIntentId).set({
        releaseIntentId,
        repository: repositoryField,
        version: "v-not-a-version",
        sourceBranch,
        sourceRevision,
        requestedAt: Timestamp.now(),
      });
      const repository = createFirestoreReleaseIntentRepository();

      // Act
      const outcome = await repository.recordReleaseMergeResult(releaseIntentId, mainMergeIdentity());

      // Assert
      expect(outcome).toEqual({ outcome: "release_intent_invalid" });
    });

    it("fails closed with release_pull_request_missing when no pull request result is persisted yet for this target", async () => {
      // Arrange
      const version = uniqueVersion();
      const releaseIntentId = `johnpwise__kanban-app--${version}`;
      const repository = createFirestoreReleaseIntentRepository();
      await repository.recordReleaseIntent(releaseIntentId, { repository: repositoryField, version, sourceBranch, sourceRevision });

      // Act
      const outcome = await repository.recordReleaseMergeResult(releaseIntentId, mainMergeIdentity());

      // Assert
      expect(outcome).toEqual({ outcome: "release_pull_request_missing" });
    });

    it("never mutates the other target's already-recorded merge result", async () => {
      // Arrange
      const { releaseIntentId } = await seedReleaseIntentWithPullRequests();
      const docRef = firestore.collection("releaseIntents").doc(releaseIntentId);
      const repository = createFirestoreReleaseIntentRepository();
      await repository.recordReleaseMergeResult(releaseIntentId, mainMergeIdentity());
      const mainRecordedAtBefore = (await docRef.get()).data()?.merges?.main?.recordedAt;

      // Act — a conflicting attempt on develop must never touch main.
      await repository.recordReleaseMergeResult(releaseIntentId, {
        target: "develop",
        number: developPrNumber,
        headSha: startCommitSha,
        mergeCommitSha: "5".repeat(40),
      });
      await repository.recordReleaseMergeResult(releaseIntentId, {
        target: "develop",
        number: developPrNumber,
        headSha: startCommitSha,
        mergeCommitSha: "6".repeat(40),
      });

      // Assert
      const data = (await docRef.get()).data();
      expect(data?.merges?.main?.recordedAt).toEqual(mainRecordedAtBefore);
      expect(data?.merges?.main?.mergeCommitSha).toBe("3".repeat(40));
      expect(data?.merges?.develop?.mergeCommitSha).toBe("5".repeat(40));
    });

    it("given many concurrent recordings of the same trusted merge result, exactly one create is persisted and the rest converge idempotently", async () => {
      // Arrange
      const { releaseIntentId } = await seedReleaseIntentWithPullRequests();
      const docRef = firestore.collection("releaseIntents").doc(releaseIntentId);
      const repository = createFirestoreReleaseIntentRepository();
      const identity = mainMergeIdentity();
      const attemptCount = 5;

      // Act
      const outcomes = await Promise.all(
        Array.from({ length: attemptCount }, () => repository.recordReleaseMergeResult(releaseIntentId, identity)),
      );

      // Assert
      expect(outcomes.filter((outcome) => outcome.outcome === "created")).toHaveLength(1);
      expect(outcomes.filter((outcome) => outcome.outcome === "already_recorded")).toHaveLength(attemptCount - 1);
      const data = (await docRef.get()).data();
      expect(data?.merges?.main?.mergeCommitSha).toBe("3".repeat(40));
    });
  });
});
