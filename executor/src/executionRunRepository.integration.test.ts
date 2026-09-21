import { randomUUID } from "node:crypto";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { Timestamp, getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createFirestoreExecutionRunRepository } from "./executionRunRepository";

const firestoreEmulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const describeWithEmulator = firestoreEmulatorHost ? describe : describe.skip;

describeWithEmulator("createFirestoreExecutionRunRepository().claimExecutionRun against the Firestore emulator", () => {
  const projectId = process.env.GCLOUD_PROJECT ?? "demo-kanban-app-test";
  const app = initializeApp({ projectId }, `executor-claim-repository-integration-${randomUUID()}`);
  const firestore = getFirestore(app);

  beforeAll(() => {
    expect(firestoreEmulatorHost).toMatch(/^127\.0\.0\.1:\d+$/);
  });

  afterAll(async () => {
    await deleteApp(app);
  });

  it("claims an unclaimed run and persists a durable claim marker", async () => {
    // Arrange
    const executionRunId = `req-${randomUUID()}`;
    const docRef = firestore.collection("executionRuns").doc(executionRunId);
    await docRef.set({ status: "accepted" });
    const repository = createFirestoreExecutionRunRepository();

    // Act
    const outcome = await repository.claimExecutionRun(executionRunId, "claim-1");

    // Assert
    expect(outcome).toEqual({ claimed: true });
    const data = (await docRef.get()).data();
    expect(data?.claim?.claimId).toBe("claim-1");
    expect(data?.claim?.claimedAt).toBeInstanceOf(Timestamp);
  });

  it("refuses a second claim once the run is already claimed", async () => {
    // Arrange
    const executionRunId = `req-${randomUUID()}`;
    const docRef = firestore.collection("executionRuns").doc(executionRunId);
    await docRef.set({ status: "accepted" });
    const repository = createFirestoreExecutionRunRepository();
    await repository.claimExecutionRun(executionRunId, "claim-1");

    // Act
    const outcome = await repository.claimExecutionRun(executionRunId, "claim-2");

    // Assert
    expect(outcome).toEqual({ claimed: false, reason: "already_claimed" });
    const data = (await docRef.get()).data();
    expect(data?.claim?.claimId).toBe("claim-1");
  });

  it("given many concurrent claim attempts for the same run, exactly one wins", async () => {
    // Arrange
    const executionRunId = `req-${randomUUID()}`;
    const docRef = firestore.collection("executionRuns").doc(executionRunId);
    await docRef.set({ status: "accepted" });
    const repository = createFirestoreExecutionRunRepository();
    const attemptCount = 5;
    const claimIds = Array.from({ length: attemptCount }, (_, index) => `attempt-${index}`);

    // Act
    const outcomes = await Promise.all(claimIds.map((claimId) => repository.claimExecutionRun(executionRunId, claimId)));

    // Assert
    expect(outcomes.filter((outcome) => outcome.claimed)).toHaveLength(1);
    expect(outcomes.filter((outcome) => !outcome.claimed)).toHaveLength(attemptCount - 1);

    const winningIndex = outcomes.findIndex((outcome) => outcome.claimed);
    const data = (await docRef.get()).data();
    expect(data?.claim?.claimId).toBe(claimIds[winningIndex]);
  });
});
