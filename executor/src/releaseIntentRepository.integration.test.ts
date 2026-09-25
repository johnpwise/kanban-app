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
});
